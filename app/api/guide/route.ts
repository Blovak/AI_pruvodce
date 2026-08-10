import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, corsPreflight } from "@/lib/cors";
import { createDeepSeekGuide } from "@/lib/deepseek";
import {
  authenticateRequest,
  firestoreAuthConfigured,
  serverStorageEnv,
} from "@/lib/auth-server";
import { saveAnalyticsEvent } from "@/lib/firestore-storage";

export async function POST(request: NextRequest) {
  const responseHeaders = corsHeaders(request.headers.get("origin"));
  const startedAt = Date.now();
  let analytics: Record<string, unknown> | null = null;
  let userEmail = "";
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Pro pokračování se přihlaste e-mailem." },
        { status: 401, headers: responseHeaders },
      );
    }
    userEmail = user.email;
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
    analytics = {
      action: "guide",
      userEmail,
      place: location,
      latitude: Number(latitude.toFixed(2)),
      longitude: Number(longitude.toFixed(2)),
      questionLength: userQuestion?.length || 0,
      model: process.env.DEEPSEEK_MODEL,
    };
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

    if (firestoreAuthConfigured()) {
      try {
        await saveAnalyticsEvent(serverStorageEnv(), {
          ...analytics,
          status: 200,
          durationMs: Date.now() - startedAt,
        });
      } catch (loggingError) {
        console.error("Guide analytics failed", loggingError);
      }
    }

    return NextResponse.json(content, { headers: responseHeaders });
  } catch (error) {
    console.error("Guide generation failed", error);
    if (analytics && firestoreAuthConfigured()) {
      try {
        await saveAnalyticsEvent(serverStorageEnv(), {
          ...analytics,
          status: 502,
          durationMs: Date.now() - startedAt,
          detail:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Unknown error",
        });
      } catch (loggingError) {
        console.error("Guide analytics failed", loggingError);
      }
    }
    return NextResponse.json(
      { error: "Průvodce se teď nepodařilo připravit. Zkuste to znovu." },
      { status: 502, headers: responseHeaders },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
