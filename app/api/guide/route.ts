import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, corsPreflight } from "@/lib/cors";
import { createDeepSeekGuide } from "@/lib/deepseek";
import { authenticateRequest } from "@/lib/auth-server";

export async function POST(request: NextRequest) {
  const responseHeaders = corsHeaders(request.headers.get("origin"));
  try {
    if (!(await authenticateRequest(request))) {
      return NextResponse.json(
        { error: "Pro pokračování se přihlaste e-mailem." },
        { status: 401, headers: responseHeaders },
      );
    }
  } catch (error) {
    console.error("Authentication failed", error);
    return NextResponse.json(
      { error: "Přihlášení se nepodařilo ověřit." },
      { status: 503, headers: responseHeaders },
    );
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json(
      { error: "Na serveru chybí DEEPSEEK_API_KEY." },
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

    const location = (body.label || "Neznámé místo").slice(0, 300);
    const userQuestion = body.question?.trim().slice(0, 500);
    const content = await createDeepSeekGuide(
      {
        apiKey: process.env.DEEPSEEK_API_KEY,
        model: process.env.DEEPSEEK_MODEL,
      },
      {
        latitude,
        longitude,
        label: location,
        question: userQuestion,
      },
    );

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
