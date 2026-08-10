import { geohashForLocation } from "geofire-common";
import { ADMIN_EMAIL } from "../lib/admin";
import {
  FirestoreEnv,
  getDocument,
  hmacSha256,
  queryDocuments,
  setDocument,
  sha256,
} from "../lib/firestore-rest";

type MigrationEnv = FirestoreEnv & {
  AUTH_SECRET?: string;
  GOOGLE_LOG_URL?: string;
  GOOGLE_LOG_TOKEN?: string;
};

type Dataset =
  | "usage"
  | "errors"
  | "feedback"
  | "cache"
  | "users"
  | "authCodes"
  | "authSessions";

type ExportPage = {
  ok?: boolean;
  dataset: Dataset;
  sheet: string;
  headers: string[];
  totalRows: number;
  offset: number;
  rows: unknown[][];
  nextOffset: number | null;
  error?: string;
};

const datasets: Dataset[] = [
  "usage",
  "errors",
  "feedback",
  "cache",
  "users",
  "authCodes",
  "authSessions",
];

function required(env: MigrationEnv, key: keyof MigrationEnv) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`Chybí proměnná ${key}.`);
  return value;
}

async function fetchDataset(env: MigrationEnv, dataset: Dataset) {
  const url = required(env, "GOOGLE_LOG_URL");
  const token = required(env, "GOOGLE_LOG_TOKEN");
  const rows: unknown[][] = [];
  let offset: number | null = 0;
  let headers: string[] = [];
  let sheet = "";
  while (offset !== null) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        token,
        operation: "migrationExport",
        dataset,
        offset,
        limit: 250,
      }),
    });
    if (!response.ok) throw new Error(`Export ${dataset}: HTTP ${response.status}`);
    const page = (await response.json()) as ExportPage;
    if (!page.ok) throw new Error(`Export ${dataset}: ${page.error || "chyba"}`);
    headers = page.headers;
    sheet = page.sheet;
    rows.push(...page.rows);
    offset = page.nextOffset;
  }
  return { dataset, sheet, headers, rows };
}

function text(value: unknown) {
  return String(value == null ? "" : value);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown) {
  return value === true || text(value).toLowerCase() === "true";
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function parseGuide(value: unknown) {
  try {
    const parsed = JSON.parse(text(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function rowId(dataset: string, row: unknown[], index: number) {
  return sha256(`${dataset}:${index + 2}:${JSON.stringify(row)}`);
}

async function migrateUsage(
  env: MigrationEnv,
  rows: unknown[][],
  apply: boolean,
) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const data = {
      timestamp: iso(row[0]),
      session: text(row[1]),
      action: text(row[2]),
      status: number(row[3]),
      durationMs: number(row[4]),
      place: text(row[5]),
      latitude: number(row[6]),
      longitude: number(row[7]),
      questionLength: number(row[8]),
      inputChars: number(row[9]),
      model: text(row[10]),
      detail: text(row[11]),
      migratedFromSheet: true,
    };
    if (apply) {
      await setDocument(env, `usageEvents/${await rowId("usage", row, index)}`, data);
    }
  }
}

async function migrateErrors(
  env: MigrationEnv,
  rows: unknown[][],
  apply: boolean,
) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (apply) {
      await setDocument(env, `errorEvents/${await rowId("errors", row, index)}`, {
        timestamp: iso(row[0]),
        session: text(row[1]),
        action: text(row[2]),
        status: number(row[3]),
        place: text(row[4]),
        error: text(row[5]),
        migratedFromSheet: true,
      });
    }
  }
}

async function migrateFeedback(
  env: MigrationEnv,
  rows: unknown[][],
  apply: boolean,
) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (apply) {
      await setDocument(
        env,
        `feedback/${await rowId("feedback", row, index)}`,
        {
          timestamp: iso(row[0]),
          session: text(row[1]),
          rating: text(row[2]),
          place: text(row[3]),
          note: text(row[4]),
          migratedFromSheet: true,
        },
      );
    }
  }
}

async function migrateCache(
  env: MigrationEnv,
  rows: unknown[][],
  apply: boolean,
) {
  let skipped = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const latitude = number(row[3]);
    const longitude = number(row[4]);
    const guide = parseGuide(row[6]);
    if (
      !guide ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      skipped += 1;
      continue;
    }
    if (apply) {
      await setDocument(env, `guideCache/${await rowId("cache", row, index)}`, {
        createdAt: iso(row[0]),
        validUntil: iso(row[1]),
        cacheKey: text(row[2]),
        latitude,
        longitude,
        geohash: geohashForLocation([latitude, longitude]),
        place: text(row[5]),
        guide,
        mp3Url: text(row[7]),
        driveFileId: text(row[8]),
        textModel: text(row[9]),
        voiceModel: text(row[10]),
        lastUsedAt: iso(row[11]),
        hits: number(row[12]),
        createdByEmail: ADMIN_EMAIL,
        migratedFromSheet: true,
      });
    }
  }
  return skipped;
}

async function migrateUsers(
  env: MigrationEnv,
  rows: unknown[][],
  apply: boolean,
) {
  const secret = required(env, "AUTH_SECRET");
  for (const row of rows) {
    const email = text(row[0]).trim().toLowerCase();
    if (!email) continue;
    const id = await hmacSha256(secret, `user:${email}`);
    if (apply) {
      await setDocument(env, `users/${id}`, {
        email,
        createdAt: iso(row[1]),
        lastLoginAt: iso(row[2]),
        status: text(row[3]) || "aktivní",
        migratedFromSheet: true,
      });
    }
  }
}

async function migrateAuthCodes(
  env: MigrationEnv,
  rows: unknown[][],
  apply: boolean,
) {
  const secret = required(env, "AUTH_SECRET");
  const latest = new Map<string, { row: unknown[]; index: number }>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const email = text(row[0]).trim().toLowerCase();
    if (!email) continue;
    latest.set(email, { row, index });
    if (apply) {
      await setDocument(
        env,
        `authCodeHistory/${await rowId("authCodes", row, index)}`,
        {
          email,
          codeHash: text(row[1]),
          createdAt: iso(row[2]),
          expiresAt: iso(row[3]),
          attempts: number(row[4]),
          used: bool(row[5]),
          migratedFromSheet: true,
        },
      );
    }
  }
  for (const [email, entry] of latest) {
    const id = await hmacSha256(secret, `email:${email}`);
    const recent = rows
      .filter(
        (row) =>
          text(row[0]).trim().toLowerCase() === email &&
          Date.parse(iso(row[2])) > Date.now() - 15 * 60 * 1000,
      )
      .map((row) => iso(row[2]));
    if (apply) {
      await setDocument(env, `authCodes/${id}`, {
        email,
        codeHash: text(entry.row[1]),
        createdAt: iso(entry.row[2]),
        expiresAt: iso(entry.row[3]),
        attempts: number(entry.row[4]),
        used: bool(entry.row[5]),
        requestTimes: recent,
        migratedFromSheet: true,
      });
    }
  }
}

async function migrateAuthSessions(
  env: MigrationEnv,
  rows: unknown[][],
  apply: boolean,
) {
  for (const row of rows) {
    const tokenHash = text(row[0]);
    if (!tokenHash) continue;
    if (apply) {
      await setDocument(env, `authSessions/${tokenHash}`, {
        email: text(row[1]).trim().toLowerCase(),
        createdAt: iso(row[2]),
        expiresAt: iso(row[3]),
        lastUsedAt: iso(row[4]),
        revoked: bool(row[5]),
        migratedFromSheet: true,
      });
    }
  }
}

async function verifySamples(
  env: MigrationEnv,
  exports: Awaited<ReturnType<typeof fetchDataset>>[],
) {
  const cache = exports.find((item) => item.dataset === "cache");
  const sessions = exports.find((item) => item.dataset === "authSessions");
  if (cache?.rows.length) {
    const id = await rowId("cache", cache.rows[0], 0);
    if (!(await getDocument(env, `guideCache/${id}`))) {
      throw new Error("Kontrolní čtení první cache položky selhalo.");
    }
  }
  if (sessions?.rows.length) {
    const id = text(sessions.rows[0][0]);
    if (id && !(await getDocument(env, `authSessions/${id}`))) {
      throw new Error("Kontrolní čtení první relace selhalo.");
    }
  }
  const manifest = await getDocument<{ counts?: Record<string, number> }>(
    env,
    "migration/latest",
  );
  if (!manifest?.data.counts) throw new Error("Chybí migrační manifest.");
}

async function main() {
  const env = process.env as MigrationEnv;
  const apply = process.argv.includes("--apply");
  if (process.argv.includes("--check")) {
    required(env, "FIREBASE_PROJECT_ID");
    required(env, "FIREBASE_CLIENT_EMAIL");
    required(env, "FIREBASE_PRIVATE_KEY");
    await getDocument(env, "migration/connection-check");
    console.log(`Připojení k Firestore projektu ${env.FIREBASE_PROJECT_ID} funguje.`);
    return;
  }
  required(env, "GOOGLE_LOG_URL");
  required(env, "GOOGLE_LOG_TOKEN");
  const exports = [];
  for (const dataset of datasets) exports.push(await fetchDataset(env, dataset));

  const counts = Object.fromEntries(
    exports.map((item) => [item.dataset, item.rows.length]),
  );
  console.log(apply ? "Migrace do Firestore" : "Kontrola migrace bez zápisu");
  console.table(counts);
  if (!apply) {
    console.log("Pro zápis spusťte stejný příkaz s parametrem --apply.");
    return;
  }

  required(env, "FIREBASE_PROJECT_ID");
  required(env, "FIREBASE_CLIENT_EMAIL");
  required(env, "FIREBASE_PRIVATE_KEY");
  required(env, "AUTH_SECRET");

  const byName = Object.fromEntries(exports.map((item) => [item.dataset, item.rows]));
  await migrateUsage(env, byName.usage, true);
  await migrateErrors(env, byName.errors, true);
  await migrateFeedback(env, byName.feedback, true);
  const skippedCacheRows = await migrateCache(env, byName.cache, true);
  await migrateUsers(env, byName.users, true);
  await migrateAuthCodes(env, byName.authCodes, true);
  await migrateAuthSessions(env, byName.authSessions, true);
  await setDocument(env, "migration/latest", {
    completedAt: new Date().toISOString(),
    source: "google-sheets",
    counts,
    skippedCacheRows,
  });
  await verifySamples(env, exports);
  console.log(
    `Migrace dokončena a kontrolní čtení prošlo. Přeskočené cache řádky: ${skippedCacheRows}.`,
  );
}

await main();
