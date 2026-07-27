import OpenAI from "openai";

type WorkerEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_TTS_MODEL?: string;
  OPENAI_TTS_VOICE?: string;
  GOOGLE_LOG_URL?: string;
  GOOGLE_LOG_TOKEN?: string;
};

type Analytics = {
  action: string;
  session?: string;
  status?: number;
  durationMs?: number;
  place?: string;
  latitude?: number;
  longitude?: number;
  questionLength?: number;
  inputChars?: number;
  model?: string;
  detail?: string;
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

const allowedOrigins = new Set([
  "https://blovak.github.io",
  "http://localhost:3000",
]);

const guideSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "placeName",
    "subtitle",
    "era",
    "overview",
    "story",
    "facts",
    "nearby",
    "question",
    "sourceUrls",
  ],
  properties: {
    placeName: { type: "string" },
    subtitle: { type: "string" },
    era: { type: "string" },
    overview: { type: "string" },
    story: { type: "string" },
    facts: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "text"],
        properties: {
          title: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    nearby: {
      type: "array",
      minItems: 0,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "distance", "kind"],
        properties: {
          name: { type: "string" },
          distance: { type: "string" },
          kind: { type: "string" },
        },
      },
    },
    question: { type: "string" },
    sourceUrls: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
  },
} as const;

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin":
      origin && allowedOrigins.has(origin) ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Mistopis-Session",
    Vary: "Origin",
  };
}

function json(
  value: unknown,
  status = 200,
  origin: string | null = null,
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...cors(origin),
    },
  });
}

async function geocode(
  url: URL,
  origin: string | null,
  analytics: Analytics,
) {
  const headers = {
    "User-Agent": "Mistopis-beta/0.1 (AI location guide)",
    "Accept-Language": "cs,en;q=0.7",
  };
  const query = url.searchParams.get("q")?.trim();

  if (query) {
    analytics.action = "geocode_search";
    const target = new URL("https://nominatim.openstreetmap.org/search");
    target.searchParams.set("q", query.slice(0, 160));
    target.searchParams.set("format", "jsonv2");
    target.searchParams.set("limit", "5");
    target.searchParams.set("addressdetails", "1");
    const result = await fetch(target, { headers });
    if (!result.ok) throw new Error("Geocoding service failed");
    const places = (await result.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;
    return json(
      places.map((place) => ({
        label: place.display_name,
        latitude: Number(place.lat),
        longitude: Number(place.lon),
      })),
      200,
      origin,
    );
  }

  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  analytics.action = "geocode_reverse";
  analytics.latitude = latitude;
  analytics.longitude = longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return json({ error: "Chybí platná poloha." }, 400, origin);
  }

  const target = new URL("https://nominatim.openstreetmap.org/reverse");
  target.searchParams.set("lat", String(latitude));
  target.searchParams.set("lon", String(longitude));
  target.searchParams.set("format", "jsonv2");
  target.searchParams.set("zoom", "18");
  const result = await fetch(target, { headers });
  if (!result.ok) throw new Error("Reverse geocoding service failed");
  const place = (await result.json()) as { display_name?: string };
  return json(
    {
      label:
        place.display_name ??
        `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      latitude,
      longitude,
    },
    200,
    origin,
  );
}

async function guide(
  request: Request,
  env: WorkerEnv,
  origin: string | null,
  analytics: Analytics,
) {
  if (!env.OPENAI_API_KEY) {
    return json(
      { error: "Na serveru chybí OPENAI_API_KEY." },
      503,
      origin,
    );
  }

  const body = (await request.json()) as Record<string, unknown>;
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return json({ error: "Neplatná poloha." }, 400, origin);
  }

  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
  });
  const location = String(body.label || "Neznámé místo").slice(0, 300);
  const userQuestion = String(body.question || "").trim().slice(0, 500);
  analytics.place = location;
  analytics.latitude = latitude;
  analytics.longitude = longitude;
  analytics.questionLength = userQuestion.length;
  analytics.model = env.OPENAI_TEXT_MODEL || "gpt-5.6-sol";
  const result = await client.responses.create({
    model: env.OPENAI_TEXT_MODEL || "gpt-5.6-sol",
    instructions: `Role: Jsi Místopis, zvídavý a spolehlivý český průvodce místní historií.

Cíl: Vytvoř krátký mobilní výklad k přesnému místu. Uživatel má mít pocit, že se na známé okolí dívá novýma očima.

Pravidla:
- Piš přirozeně česky, konkrétně a bez turistických klišé.
- Ověř historická tvrzení pomocí webového vyhledávání. Upřednostni obce, památkové katalogy, muzea a encyklopedické zdroje.
- Nevymýšlej si přesné události, osoby ani vzdálenosti. Když pro přesný bod nejsou podklady, popiš spolehlivě širší okolí a přiznej rozsah.
- story má 110–170 slov, overview nejvýše 35 slov, každá zajímavost nejvýše 35 slov.
- sourceUrls obsahuje pouze skutečně použité veřejné URL.
- era je krátký štítek velkými písmeny.
- nearby obsahuje jen doložitelné cíle v rozumné pěší vzdálenosti.

Výstup musí přesně odpovídat JSON schématu.`,
    input: `Poloha: ${location}
Souřadnice: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}
${userQuestion ? `Doplňující otázka uživatele: ${userQuestion}` : "Připrav první seznámení s místem."}`,
    tools: [{ type: "web_search" }],
    include: ["web_search_call.action.sources"],
    reasoning: { effort: "low" },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "location_guide",
        strict: true,
        schema: guideSchema,
      },
    },
  });

  return json(JSON.parse(result.output_text), 200, origin);
}

async function speech(
  request: Request,
  env: WorkerEnv,
  origin: string | null,
  analytics: Analytics,
) {
  if (!env.OPENAI_API_KEY) {
    return json(
      { error: "Na serveru chybí OPENAI_API_KEY." },
      503,
      origin,
    );
  }

  const body = (await request.json()) as { text?: string };
  const text = String(body.text || "").trim();
  analytics.inputChars = text.length;
  analytics.model = env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  if (!text || text.length > 4096) {
    return json(
      { error: "Text pro poslech musí mít 1 až 4096 znaků." },
      400,
      origin,
    );
  }

  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
  });
  const audio = await client.audio.speech.create({
    model: env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    voice:
      (env.OPENAI_TTS_VOICE as
        | "alloy"
        | "ash"
        | "ballad"
        | "coral"
        | "echo"
        | "fable"
        | "nova"
        | "onyx"
        | "sage"
        | "shimmer"
        | "verse"
        | "marin"
        | "cedar") || "marin",
    input: text,
    instructions:
      "Mluv přirozenou, kultivovanou češtinou. Klidné tempo, vřelý dokumentární tón, lehká zvědavost. Správně vyslovuj česká místní jména.",
    response_format: "mp3",
  });

  return new Response(await audio.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
      ...cors(origin),
    },
  });
}

async function logUsage(env: WorkerEnv, analytics: Analytics) {
  if (!env.GOOGLE_LOG_URL || !env.GOOGLE_LOG_TOKEN) return;

  try {
    await fetch(env.GOOGLE_LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        token: env.GOOGLE_LOG_TOKEN,
        event: analytics,
      }),
    });
  } catch (error) {
    console.error("Analytics logging failed", error);
  }
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    const url = new URL(request.url);
    const shouldLog =
      url.pathname.startsWith("/api/") && url.pathname !== "/api/health";
    const startedAt = Date.now();
    const analytics: Analytics = {
      action: url.pathname.replace("/api/", "") || "unknown",
      session: request.headers.get("X-Mistopis-Session")?.slice(0, 80),
    };

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ status: "ok" }, 200, origin);
      }
      let response: Response;
      if (request.method === "GET" && url.pathname === "/api/geocode") {
        response = await geocode(url, origin, analytics);
      } else if (request.method === "POST" && url.pathname === "/api/guide") {
        response = await guide(request, env, origin, analytics);
      } else if (request.method === "POST" && url.pathname === "/api/speech") {
        response = await speech(request, env, origin, analytics);
      } else {
        response = json({ error: "Endpoint neexistuje." }, 404, origin);
      }

      analytics.status = response.status;
      analytics.durationMs = Date.now() - startedAt;
      if (shouldLog) context.waitUntil(logUsage(env, analytics));
      return response;
    } catch (error) {
      console.error("Request failed", error);
      analytics.status = 502;
      analytics.durationMs = Date.now() - startedAt;
      analytics.detail =
        error instanceof Error ? error.message.slice(0, 300) : "Unknown error";
      if (shouldLog) context.waitUntil(logUsage(env, analytics));
      return json(
        { error: "Server požadavek nedokončil. Zkuste to znovu." },
        502,
        origin,
      );
    }
  },
};
