import { NextRequest, NextResponse } from "next/server";
import {
  authStorageRequest,
  firestoreAuthConfigured,
  serverStorageEnv,
} from "@/lib/auth-server";
import { corsHeaders, corsPreflight } from "@/lib/cors";
import { verifyAuthCode } from "@/lib/firestore-storage";

type VerifyCodeResult = {
  verified?: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
};

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));
  try {
    const body = (await request.json()) as { email?: string; code?: string };
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").replace(/\s/g, "");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ||
      !/^\d{6}$/.test(code)
    ) {
      return NextResponse.json(
        { error: "Zadejte platný šestimístný kód." },
        { status: 400, headers },
      );
    }

    const result = firestoreAuthConfigured()
      ? await verifyAuthCode(serverStorageEnv(), email, code)
      : await authStorageRequest<VerifyCodeResult>("authVerifyCode", {
          email,
          code,
        });
    if (!result.verified || !result.token) {
      return NextResponse.json(
        {
          error:
            result.error === "too_many_attempts"
              ? "Příliš mnoho pokusů. Nechte si poslat nový kód."
              : "Kód není platný nebo už vypršel.",
        },
        { status: 401, headers },
      );
    }
    return NextResponse.json(
      {
        token: result.token,
        expiresAt: result.expiresAt,
        user: { email },
      },
      { headers },
    );
  } catch (error) {
    console.error("Auth verification failed", error);
    return NextResponse.json(
      { error: "Kód se teď nepodařilo ověřit." },
      { status: 503, headers },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
