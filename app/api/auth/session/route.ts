import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth-server";
import { corsHeaders, corsPreflight } from "@/lib/cors";

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));
  try {
    const user = await authenticateRequest(request, { recordLogin: true });
    return user
      ? NextResponse.json({ user: { email: user.email } }, { headers })
      : NextResponse.json(
          { error: "Relace není platná." },
          { status: 401, headers },
        );
  } catch (error) {
    console.error("Auth session check failed", error);
    return NextResponse.json(
      { error: "Relaci se nepodařilo ověřit." },
      { status: 503, headers },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
