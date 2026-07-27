import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { corsHeaders, corsPreflight } from "@/lib/cors";

export async function POST(request: NextRequest) {
  const responseHeaders = corsHeaders(request.headers.get("origin"));
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Na serveru chybí OPENAI_API_KEY." },
      { status: 503, headers: responseHeaders },
    );
  }

  try {
    const { text } = (await request.json()) as { text?: string };
    const cleanText = text?.trim();

    if (!cleanText || cleanText.length > 4096) {
      return NextResponse.json(
        { error: "Text pro poslech musí mít 1 až 4096 znaků." },
        { status: 400, headers: responseHeaders },
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
      input: cleanText,
      instructions:
        "Mluv přirozenou, kultivovanou češtinou. Klidné tempo, vřelý dokumentární tón, lehká zvědavost. Správně vyslovuj česká místní jména.",
      response_format: "mp3",
    });

    return new NextResponse(await audio.arrayBuffer(), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        ...responseHeaders,
      },
    });
  } catch (error) {
    console.error("Speech generation failed", error);
    return NextResponse.json(
      { error: "Zvuk se teď nepodařilo vytvořit." },
      { status: 502, headers: responseHeaders },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
