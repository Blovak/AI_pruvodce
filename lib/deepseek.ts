import type { GuideContent } from "./types";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const MAX_SOURCE_CHARS = 2600;

type DeepSeekConfig = {
  apiKey: string;
  model?: string;
};

type Source = {
  title: string;
  url: string;
  extract: string;
  latitude: number;
  longitude: number;
};

type WikipediaPage = {
  pageid?: number;
  title?: string;
  extract?: string;
  fullurl?: string;
  index?: number;
  coordinates?: Array<{
    lat?: number;
    lon?: number;
  }>;
};

const guideShape = {
  placeName: "Název místa",
  subtitle: "Krátký podtitul",
  era: "OBDOBÍ",
  overview: "Úvod nejvýše 35 slov.",
  story: "Hlavní příběh v rozsahu 110 až 170 slov.",
  facts: [
    { title: "Zajímavost 1", text: "Text nejvýše 35 slov." },
    { title: "Zajímavost 2", text: "Text nejvýše 35 slov." },
    { title: "Zajímavost 3", text: "Text nejvýše 35 slov." },
  ],
  nearby: [
    { sourceIndex: 2, kind: "památka" },
  ],
  question: "Krátká navazující otázka pro uživatele.",
  sourceUrls: [],
};

function wikipediaUrl(latitude: number, longitude: number, radius: number) {
  const url = new URL("https://cs.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("generator", "geosearch");
  url.searchParams.set("ggscoord", `${latitude}|${longitude}`);
  url.searchParams.set("ggsradius", String(radius));
  url.searchParams.set("ggslimit", "20");
  url.searchParams.set("ggsnamespace", "0");
  url.searchParams.set("prop", "extracts|info|coordinates");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("inprop", "url");
  url.searchParams.set("origin", "*");
  return url;
}

async function nearbySources(latitude: number, longitude: number) {
  for (const radius of [3000, 10000]) {
    try {
      const response = await fetch(wikipediaUrl(latitude, longitude, radius), {
        headers: {
          "User-Agent": "Mistopis-beta/0.2 (AI location guide)",
          Accept: "application/json",
        },
      });
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        query?: { pages?: WikipediaPage[] };
      };
      const sources = (payload.query?.pages ?? [])
        .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
        .filter(
          (
            page,
          ): page is WikipediaPage &
            Required<Pick<WikipediaPage, "title" | "fullurl">> =>
            Boolean(
              page.title &&
                page.fullurl &&
                page.extract &&
                Number.isFinite(page.coordinates?.[0]?.lat) &&
                Number.isFinite(page.coordinates?.[0]?.lon),
            ),
        )
        .map((page) => ({
          title: page.title,
          url: page.fullurl,
          extract: String(page.extract).slice(0, MAX_SOURCE_CHARS),
          latitude: Number(page.coordinates?.[0]?.lat),
          longitude: Number(page.coordinates?.[0]?.lon),
        }));

      if (sources.length > 0) return sources;
    } catch {
      // Výklad může vzniknout opatrně i při dočasném výpadku Wikipedie.
    }
  }

  return [];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadiusMeters = 6371008.8;
  const toRadians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * toRadians;
  const longitudeDelta = (longitudeB - longitudeA) * toRadians;
  const latitudeARadians = latitudeA * toRadians;
  const latitudeBRadians = latitudeB * toRadians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    earthRadiusMeters *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function approximateDistance(value: number) {
  if (value < 1000) {
    const rounded = Math.max(10, Math.round(value / 10) * 10);
    return `přibližně ${rounded} m`;
  }
  return `přibližně ${(value / 1000).toFixed(1).replace(".", ",")} km`;
}

function normalizeNearby(
  value: unknown[],
  sources: Source[],
  origin: { latitude: number; longitude: number },
) {
  const selected = new Map<number, string>();
  for (const item of value.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const place = item as Record<string, unknown>;
    const sourceIndex = Number(place.sourceIndex);
    if (
      Number.isInteger(sourceIndex) &&
      sourceIndex >= 1 &&
      sourceIndex <= sources.length &&
      !selected.has(sourceIndex) &&
      distanceMeters(
        origin.latitude,
        origin.longitude,
        sources[sourceIndex - 1].latitude,
        sources[sourceIndex - 1].longitude,
      ) >= 30
    ) {
      selected.set(sourceIndex, text(place.kind, "místní zajímavost"));
    }
  }

  for (let sourceIndex = 1; sourceIndex <= sources.length; sourceIndex += 1) {
    if (selected.size >= 4) break;
    if (
      !selected.has(sourceIndex) &&
      distanceMeters(
        origin.latitude,
        origin.longitude,
        sources[sourceIndex - 1].latitude,
        sources[sourceIndex - 1].longitude,
      ) >= 30
    ) {
      selected.set(sourceIndex, "místní zajímavost");
    }
  }

  return Array.from(selected.entries()).flatMap(([sourceIndex, kind]) => {
    const source = sources[sourceIndex - 1];
    const distance = distanceMeters(
      origin.latitude,
      origin.longitude,
      source.latitude,
      source.longitude,
    );
    if (distance < 30) return [];
    return [
      {
        name: source.title,
        distance: approximateDistance(distance),
        kind,
        latitude: source.latitude,
        longitude: source.longitude,
      },
    ];
  });
}

function normalizeGuide(
  value: unknown,
  sources: Source[],
  origin: { latitude: number; longitude: number },
): GuideContent {
  if (!value || typeof value !== "object") {
    throw new Error("DeepSeek vrátil neplatný JSON.");
  }

  const raw = value as Record<string, unknown>;
  const facts = Array.isArray(raw.facts) ? raw.facts : [];
  const nearby = Array.isArray(raw.nearby) ? raw.nearby : [];
  const normalizedFacts = facts.slice(0, 3).map((item, index) => {
    const fact = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      title: text(fact.title, `Zajímavost ${index + 1}`),
      text: text(fact.text),
    };
  });

  if (
    !text(raw.placeName) ||
    !text(raw.overview) ||
    !text(raw.story) ||
    normalizedFacts.length !== 3 ||
    normalizedFacts.some((fact) => !fact.text)
  ) {
    throw new Error("DeepSeek nevrátil úplný výklad.");
  }

  return {
    placeName: text(raw.placeName),
    subtitle: text(raw.subtitle),
    era: text(raw.era, "MÍSTNÍ HISTORIE").toUpperCase(),
    overview: text(raw.overview),
    story: text(raw.story),
    facts: normalizedFacts,
    nearby: normalizeNearby(nearby, sources, origin),
    question: text(raw.question, "Co dalšího vás na tomto místě zajímá?"),
    sourceUrls: sources.slice(0, 5).map((source) => source.url),
  };
}

export async function createDeepSeekGuide(
  config: DeepSeekConfig,
  input: {
    latitude: number;
    longitude: number;
    label: string;
    question?: string;
  },
) {
  const sources = await nearbySources(input.latitude, input.longitude);
  const sourceContext =
    sources.length > 0
      ? sources
          .slice(0, 5)
          .map(
            (source, index) =>
              `[${index + 1}] ${source.title}\nSouřadnice: ${source.latitude.toFixed(6)}, ${source.longitude.toFixed(6)}\nURL: ${source.url}\n${source.extract}`,
          )
          .join("\n\n")
      : "Pro bezprostřední okolí nebyl nalezen vhodný článek. Neuváděj nedoložené přesné historické údaje a otevřeně popiš širší kontext.";

  const systemPrompt = `Jsi Místopis, zvídavý a spolehlivý český průvodce místní historií.

Vrať pouze jeden validní JSON objekt přesně podle uvedeného příkladu struktury. Nepoužívej Markdown.

Pravidla:
- Piš přirozeně česky, konkrétně a bez turistických klišé.
- Historická tvrzení opírej pouze o podklady přiložené uživatelem.
- Nevymýšlej si přesné události, osoby ani vzdálenosti.
- Když podklady nestačí pro přesný bod, popiš širší okolí a přiznej rozsah.
- story má 110–170 slov, overview nejvýše 35 slov, každá zajímavost nejvýše 35 slov.
- facts musí mít přesně 3 položky a nearby nejvýše 4 položky.
- sourceUrls vrať jako prázdné pole; skutečné URL bezpečně doplní server.
- nearby obsahuje jen jiné cíle z očíslovaných podkladů, ne právě popisované místo.
- Každá nearby položka používá sourceIndex odkazující na číslo podkladu a stručný kind.
- Nevkládej do nearby název, vzdálenost ani souřadnice; ty bezpečně doplní server.

Příklad požadované JSON struktury:
${JSON.stringify(guideShape)}`;

  const userPrompt = `Poloha: ${input.label}
Souřadnice: ${input.latitude.toFixed(6)}, ${input.longitude.toFixed(6)}
${input.question ? `Doplňující otázka uživatele: ${input.question}` : "Připrav první seznámení s místem."}

Podklady:
${sourceContext}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model || DEFAULT_DEEPSEEK_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          max_tokens: 3200,
          temperature: 0.3,
          stream: false,
        }),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`DeepSeek API HTTP ${response.status}: ${detail}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string | null };
        }>;
      };
      const choice = payload.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new Error("DeepSeek ukončil odpověď před dokončením JSON.");
      }
      const content = choice?.message?.content?.trim();
      if (!content) throw new Error("DeepSeek vrátil prázdnou odpověď.");
      return normalizeGuide(JSON.parse(content), sources, input);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("DeepSeek výklad nevytvořil.");
}

export const defaultDeepSeekModel = DEFAULT_DEEPSEEK_MODEL;
