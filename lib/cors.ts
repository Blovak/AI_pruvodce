import { NextResponse } from "next/server";

const allowedOrigins = new Set([
  "https://blovak.github.io",
  "http://localhost:3000",
]);

export function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Mistopis-Session",
    Vary: "Origin",
  };
}

export function corsPreflight(origin: string | null) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
