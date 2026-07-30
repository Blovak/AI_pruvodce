import { NextRequest, NextResponse } from "next/server";
import { authStorageRequest } from "@/lib/auth-server";
import { corsHeaders, corsPreflight } from "@/lib/cors";

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

    const result = await authStorageRequest<RequestCodeResult>(
      "authRequestCode",
      { email },
    );
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
