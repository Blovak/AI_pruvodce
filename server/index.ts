import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import OpenAI from "openai";

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

function cors(origin: string | undefined) {
  return {
    "Access-Control-Allow-Origin":
      origin && allowedOrigins.has(origin) ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  origin?: string,
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...cors(origin),
  });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

async function geocode(
  url: URL,
  response: ServerResponse,
  origin?: string,
) {
  const headers = {
    "User-Agent": "Mistopis-beta/0.1 (AI location guide)",
    "Accept-Language": "cs,en;q=0.7",
  };
  const query = url.searchParams.get("q")?.trim();

  if (query) {
    const target = new URL("https://nominatim.openstreetmap.org/search");
    target.searchParams.set("q", query.slice(0, 160));
    target.searchParams.set("format", "jsonv2");
    target.searchParams.set("limit", "5");
    target.searchParams.set("addressdetails", "1");
    const result = await fetch(target, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (!result.ok) throw new Error("Geocoding service failed");
    const places = (await result.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;
    return sendJson(
      response,
      200,
      places.map((place) => ({
        label: place.display_name,
        latitude: Number(place.lat),
        longitude: Number(place.lon),
      })),
      origin,
    );
  }

  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return sendJson(response, 400, { error: "Chybí platná poloha." }, origin);
  }

  const target = new URL("https://nominatim.openstreetmap.org/reverse");
  target.searchParams.set("lat", String(latitude));
  target.searchParams.set("lon", String(longitude));
  target.searchParams.set("format", "jsonv2");
  target.searchParams.set("zoom", "18");
  const result = await fetch(target, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  if (!result.ok) throw new Error("Reverse geocoding service failed");
  const place = (await result.json()) as { display_name?: string };
  return sendJson(
    response,
    200,
    {
      label:
        place.display_name ??
        `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      latitude,
      longitude,
    },
    origin,
  );
}

async function guide(
  request: IncomingMessage,
  response: ServerResponse,
  origin?: string,
) {
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(
      response,
      503,
      { error: "Na serveru chybí OPENAI_API_KEY." },
      origin,
    );
  }

  const body = await readJson(request);
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
    return sendJson(response, 400, { error: "Neplatná poloha." }, origin);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const location = String(body.label || "Neznámé místo").slice(0, 300);
  const userQuestion = String(body.question || "").trim().slice(0, 500);
  const result = await client.responses.create({
    model: process.env.OPENAI_TEXT_MODEL || "gpt-5.6-sol",
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

  return sendJson(response, 200, JSON.parse(result.output_text), origin);
}

async function speech(
  request: IncomingMessage,
  response: ServerResponse,
  origin?: string,
) {
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(
      response,
      503,
      { error: "Na serveru chybí OPENAI_API_KEY." },
      origin,
    );
  }

  const body = await readJson(request);
  const text = String(body.text || "").trim();
  if (!text || text.length > 4096) {
    return sendJson(
      response,
      400,
      { error: "Text pro poslech musí mít 1 až 4096 znaků." },
      origin,
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const audio = await client.audio.speech.create({
    model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    voice:
      (process.env.OPENAI_TTS_VOICE as
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

  response.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "private, max-age=3600",
    ...cors(origin),
  });
  response.end(Buffer.from(await audio.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors(origin));
    return response.end();
  }

  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || "localhost"}`,
  );

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { status: "ok" }, origin);
    }
    if (request.method === "GET" && url.pathname === "/api/geocode") {
      return await geocode(url, response, origin);
    }
    if (request.method === "POST" && url.pathname === "/api/guide") {
      return await guide(request, response, origin);
    }
    if (request.method === "POST" && url.pathname === "/api/speech") {
      return await speech(request, response, origin);
    }
    return sendJson(response, 404, { error: "Endpoint neexistuje." }, origin);
  } catch (error) {
    console.error("Request failed", error);
    return sendJson(
      response,
      502,
      { error: "Server požadavek nedokončil. Zkuste to znovu." },
      origin,
    );
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`Místopis server naslouchá na portu ${port}`);
});
