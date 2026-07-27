import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { corsHeaders, corsPreflight } from "@/lib/cors";

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

export async function POST(request: NextRequest) {
  const responseHeaders = corsHeaders(request.headers.get("origin"));
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Na serveru chybí OPENAI_API_KEY." },
      { status: 503, headers: responseHeaders },
    );
  }

  try {
    const body = (await request.json()) as {
      latitude?: number;
      longitude?: number;
      label?: string;
      question?: string;
    };
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
      return NextResponse.json(
        { error: "Neplatná poloha." },
        { status: 400, headers: responseHeaders },
      );
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const location = (body.label || "Neznámé místo").slice(0, 300);
    const userQuestion = body.question?.trim().slice(0, 500);

    const response = await client.responses.create({
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

    const content = JSON.parse(response.output_text);
    return NextResponse.json(content, { headers: responseHeaders });
  } catch (error) {
    console.error("Guide generation failed", error);
    return NextResponse.json(
      { error: "Průvodce se teď nepodařilo připravit. Zkuste to znovu." },
      { status: 502, headers: responseHeaders },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
