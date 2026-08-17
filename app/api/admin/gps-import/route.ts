import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import {
  authStorageRequest,
  authenticateRequest,
  firestoreAuthConfigured,
  serverStorageEnv,
} from "@/lib/auth-server";
import {
  executeGpsImportStep,
  getGpsImportJob,
  GpsImportBusyError,
  type GpsImportArchiveResult,
  type GpsImportReadBatch,
} from "@/lib/admin-gps-import";
import { corsHeaders, corsPreflight } from "@/lib/cors";

async function authorize(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return { error: "Pro pokračování se přihlaste e-mailem.", status: 401 };
  }
  if (!isAdminEmail(user.email)) {
    return { error: "K této části nemáte přístup.", status: 403 };
  }
  if (!firestoreAuthConfigured()) {
    return { error: "Import vyžaduje úložiště Firestore.", status: 503 };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));
  try {
    const authorization = await authorize(request);
    if ("error" in authorization) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status, headers },
      );
    }
    return NextResponse.json(
      { job: await getGpsImportJob(serverStorageEnv()) },
      { headers },
    );
  } catch (error) {
    console.error("GPS import status failed", error);
    return NextResponse.json(
      { error: "Stav importu se nepodařilo načíst." },
      { status: 502, headers },
    );
  }
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));
  try {
    const authorization = await authorize(request);
    if ("error" in authorization) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status, headers },
      );
    }
    const body = (await request.json().catch(() => ({}))) as { reset?: boolean };
    const job = await executeGpsImportStep(
      serverStorageEnv(),
      authorization.user.email,
      body.reset === true,
      () =>
        authStorageRequest<GpsImportReadBatch>("gpsImportReadBatch", {
          limit: 25,
        }),
      (rows) =>
        authStorageRequest<GpsImportArchiveResult>("gpsImportArchiveBatch", {
          rows,
        }),
    );
    return NextResponse.json({ job }, { headers });
  } catch (error) {
    if (error instanceof GpsImportBusyError) {
      return NextResponse.json(
        { error: "Import právě zpracovává jiný požadavek." },
        { status: 409, headers },
      );
    }
    console.error("GPS import failed", error);
    return NextResponse.json(
      { error: "Import se nepodařilo dokončit. Můžete bezpečně pokračovat znovu." },
      { status: 502, headers },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get("origin"));
}
