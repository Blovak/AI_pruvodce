import { NextRequest, NextResponse } from "next/server";
import {
  authStorageRequest,
  firestoreAuthConfigured,
  serverStorageEnv,
} from "@/lib/auth-server";
import { corsHeaders, corsPreflight } from "@/lib/cors";
import {
  AuthRateLimitError,
  prepareAuthCode,
} from "@/lib/firestore-storage";

type RequestCodeResult = {
  sent?: boolean;
  retryAfterSeconds?: number;
};

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));
  try {
    const body = (await request.json()) as { email?: string };
    const email = String(body.email || "").trim().toLowerCase();
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    ) {
      return NextResponse.json(
        { error: "Zadejte platnou e-mailovou adresu." },
        { status: 400, headers },
      );
    }

    let result: RequestCodeResult;
    if (firestoreAuthConfigured()) {
      const code = await prepareAuthCode(serverStorageEnv(), email);
      result = await authStorageRequest<RequestCodeResult>(
        "sendAuthCodeEmail",
        { email, code },
      );
    } else {
      result = await authStorageRequest<RequestCodeResult>(
        "authRequestCode",
        { email },
      );
    }
    if (!result.sent) {
      return NextResponse.json(
        {
          error: "Další kód bude možné poslat za chvíli.",
          retryAfterSeconds: result.retryAfterSeconds,
        },
        { status: 429, headers },
      );
    }
    return NextResponse.json({ sent: true, email }, { headers });
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      return NextResponse.json(
        {
          error: "Další kód bude možné poslat za chvíli.",
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: 429, headers },
      );
    }
    console.error("Auth request failed", error);
    return NextResponse.json(
      { error: "Přihlašovací kód se nepodařilo odeslat." },
      { status: 503, headers },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
