import { NextRequest, NextResponse } from "next/server";
import { authStorageRequest } from "@/lib/auth-server";
import { corsHeaders, corsPreflight } from "@/lib/cors";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.match(/^Bearer\s+([A-Za-z0-9_-]{32,160})$/i)?.[1] || "";
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));
  try {
    const authToken = bearerToken(request);
    if (authToken) {
      await authStorageRequest("authLogout", { authToken });
    }
  } catch (error) {
    console.error("Auth logout failed", error);
  }
  return NextResponse.json({ loggedOut: true }, { headers });
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
