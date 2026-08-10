import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import {
  authenticateRequest,
  firestoreAuthConfigured,
  serverStorageEnv,
} from "@/lib/auth-server";
import { corsHeaders, corsPreflight } from "@/lib/cors";
import { getAdminStats } from "@/lib/firestore-storage";

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Pro pokračování se přihlaste e-mailem." },
        { status: 401, headers },
      );
    }
    if (!isAdminEmail(user.email)) {
      return NextResponse.json(
        { error: "K této části nemáte přístup." },
        { status: 403, headers },
      );
    }
    if (!firestoreAuthConfigured()) {
      return NextResponse.json(
        { error: "Administrace vyžaduje úložiště Firestore." },
        { status: 503, headers },
      );
    }

    return NextResponse.json(await getAdminStats(serverStorageEnv()), {
      headers,
    });
  } catch (error) {
    console.error("Admin stats failed", error);
    return NextResponse.json(
      { error: "Administrativní přehled se nepodařilo načíst." },
      { status: 502, headers },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
