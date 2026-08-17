import { geohashForLocation } from "geofire-common";
import type { StorageEnv } from "./firestore-storage";
import {
  getDocument,
  queryDocuments,
  runTransaction,
  setDocument,
  sha256,
} from "./firestore-rest";

const JOB_PATH = "adminJobs/gps-import";
const IMPORT_MODEL = "deepseek-v4-flash:nearby-directions-v1:gps-matrix-import";
const LEASE_MS = 2 * 60 * 1000;

export type GpsImportSourceRow = {
  rowNumber: number;
  pointId: string;
  latitude: number;
  longitude: number;
  description: string;
  descriptionHash: string;
};

export type GpsImportReadBatch = {
  ok: boolean;
  rows: GpsImportSourceRow[];
  previousDescription: string;
  hasMore: boolean;
  sourceRows: number;
  backupRows: number;
};

export type GpsImportArchiveResult = {
  ok: boolean;
  archived: number;
  deleted: number;
  appended: number;
  alreadyBackedUp: number;
  sourceRows: number;
  backupRows: number;
};

export type GpsImportStepCounts = {
  processed: number;
  created: number;
  duplicates: number;
  invalid: number;
  existingCompatible: number;
  alreadyImported: number;
  archived: number;
};

export type GpsImportJob = GpsImportStepCounts & {
  status: "idle" | "running" | "complete" | "error";
  startedAt: string;
  updatedAt: string;
  activeUntil: string;
  lastError: string;
  sourceRows: number;
  backupRows: number;
};

type CachedRecord = {
  textModel?: string;
};

type ParsedDescription = {
  key: string;
  point: Record<string, unknown>;
};

const emptyCounts = (): GpsImportStepCounts => ({
  processed: 0,
  created: 0,
  duplicates: 0,
  invalid: 0,
  existingCompatible: 0,
  alreadyImported: 0,
  archived: 0,
});

function dateValue(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

export function parseGpsDescription(value: unknown): ParsedDescription | null {
  try {
    const parsed = JSON.parse(String(value || "")) as {
      points?: unknown[];
    };
    const raw = parsed?.points?.[0];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const point = raw as Record<string, unknown>;
    const { id: _id, coordinates: _coordinates, ...content } = point;
    return { key: JSON.stringify(content), point };
  } catch {
    return null;
  }
}

export function normalizeImportedGuide(point: Record<string, unknown>) {
  const facts = strings(point.interestingFacts).slice(0, 3);
  if (
    !text(point.location) ||
    !text(point.overview) ||
    !text(point.story) ||
    facts.length !== 3
  ) {
    return null;
  }
  return {
    placeName: text(point.location),
    subtitle: "Historie a zajímavosti okolí",
    era: text(point.era, "MÍSTNÍ HISTORIE").toUpperCase(),
    overview: text(point.overview),
    story: text(point.story),
    facts: facts.map((fact, index) => ({
      title: `Zajímavost ${index + 1}`,
      text: fact,
    })),
    nearby: [],
    question: "Co dalšího vás na tomto místě zajímá?",
    sourceUrls: strings(point.sourceUrls).slice(0, 5),
  };
}

function validCoordinates(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export class GpsImportBusyError extends Error {
  constructor() {
    super("gps_import_busy");
  }
}

export async function claimGpsImportStep(
  env: StorageEnv,
  reset: boolean,
): Promise<GpsImportJob> {
  return runTransaction(env, async (transaction) => {
    const existing = await transaction.get<GpsImportJob>(JOB_PATH);
    const now = new Date();
    if (dateValue(existing?.data.activeUntil) > now.getTime()) {
      throw new GpsImportBusyError();
    }
    const counts = reset ? emptyCounts() : existing?.data || emptyCounts();
    const job: GpsImportJob = {
      ...emptyCounts(),
      ...counts,
      status: "running",
      startedAt:
        reset || !existing?.data.startedAt
          ? now.toISOString()
          : existing.data.startedAt,
      updatedAt: now.toISOString(),
      activeUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
      lastError: "",
      sourceRows: Number(existing?.data.sourceRows || 0),
      backupRows: Number(existing?.data.backupRows || 0),
    };
    transaction.set(JOB_PATH, job);
    return job;
  });
}

export async function finishGpsImportStep(
  env: StorageEnv,
  job: GpsImportJob,
  step: GpsImportStepCounts,
  result: { complete: boolean; sourceRows: number; backupRows: number },
) {
  const now = new Date().toISOString();
  const finished: GpsImportJob = {
    ...job,
    processed: job.processed + step.processed,
    created: job.created + step.created,
    duplicates: job.duplicates + step.duplicates,
    invalid: job.invalid + step.invalid,
    existingCompatible:
      job.existingCompatible + step.existingCompatible,
    alreadyImported: job.alreadyImported + step.alreadyImported,
    archived: job.archived + step.archived,
    status: result.complete ? "complete" : "running",
    updatedAt: now,
    activeUntil: now,
    lastError: "",
    sourceRows: result.sourceRows,
    backupRows: result.backupRows,
  };
  await setDocument(env, JOB_PATH, finished);
  return finished;
}

export async function failGpsImportStep(
  env: StorageEnv,
  job: GpsImportJob,
  error: unknown,
) {
  const now = new Date().toISOString();
  await setDocument(env, JOB_PATH, {
    ...job,
    status: "error",
    updatedAt: now,
    activeUntil: now,
    lastError:
      error instanceof Error ? error.message.slice(0, 300) : "unknown_error",
  });
}

export async function getGpsImportJob(env: StorageEnv) {
  const record = await getDocument<GpsImportJob>(env, JOB_PATH);
  return record?.data || null;
}

export async function importGpsRows(
  env: StorageEnv,
  batch: GpsImportReadBatch,
  createdByEmail: string,
) {
  const counts = emptyCounts();
  let previousKey = parseGpsDescription(batch.previousDescription)?.key || "";
  const spreadsheetId = "12o4RK-G9oCxYeDgDehyeTkSusKp8qU61F6yLH0c55j0";

  for (const row of batch.rows) {
    counts.processed += 1;
    const parsed = parseGpsDescription(row.description);
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!parsed || !validCoordinates(latitude, longitude)) {
      counts.invalid += 1;
      previousKey = "";
      continue;
    }
    if (parsed.key === previousKey) {
      counts.duplicates += 1;
      continue;
    }
    previousKey = parsed.key;
    const guide = normalizeImportedGuide(parsed.point);
    if (!guide) {
      counts.invalid += 1;
      continue;
    }

    const pointId = text(row.pointId, String(parsed.point.id || row.rowNumber));
    const documentId = await sha256(
      `gps-matrix:${spreadsheetId}:point:${pointId}`,
    );
    if (await getDocument(env, `guideCache/${documentId}`)) {
      counts.alreadyImported += 1;
      continue;
    }
    const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const atPoint = await queryDocuments<CachedRecord>(env, "guideCache", {
      filter: { field: "cacheKey", op: "EQUAL", value: cacheKey },
      limit: 100,
    });
    if (
      atPoint.some(({ data }) =>
        String(data.textModel || "").startsWith(
          "deepseek-v4-flash:nearby-directions-v1",
        ),
      )
    ) {
      counts.existingCompatible += 1;
      continue;
    }

    const now = new Date();
    const validUntil = new Date(now);
    validUntil.setFullYear(validUntil.getFullYear() + 1);
    await setDocument(env, `guideCache/${documentId}`, {
      cacheKey,
      latitude,
      longitude,
      geohash: geohashForLocation([latitude, longitude]),
      place: guide.placeName,
      guide,
      textModel: IMPORT_MODEL,
      createdAt: now.toISOString(),
      validUntil: validUntil.toISOString(),
      lastUsedAt: now.toISOString(),
      hits: 0,
      createdByEmail,
      importedFromSpreadsheet: spreadsheetId,
      importedFromSheet: "GPS body",
      importedFromRow: row.rowNumber,
      importedPointId: Number(parsed.point.id) || pointId,
    });
    counts.created += 1;
  }

  return {
    counts,
    archiveRows: await Promise.all(
      batch.rows.map(async (row) => ({
        rowNumber: row.rowNumber,
        pointId: row.pointId,
        descriptionHash:
          row.descriptionHash || (await sha256(row.description)),
      })),
    ),
  };
}

export async function executeGpsImportStep(
  env: StorageEnv,
  createdByEmail: string,
  reset: boolean,
  readBatch: () => Promise<GpsImportReadBatch>,
  archiveBatch: (
    rows: Array<{
      rowNumber: number;
      pointId: string;
      descriptionHash: string;
    }>,
  ) => Promise<GpsImportArchiveResult>,
) {
  const job = await claimGpsImportStep(env, reset);
  try {
    const batch = await readBatch();
    if (!Array.isArray(batch.rows) || batch.rows.length === 0) {
      return finishGpsImportStep(env, job, emptyCounts(), {
        complete: true,
        sourceRows: Number(batch.sourceRows || 0),
        backupRows: Number(batch.backupRows || 0),
      });
    }

    const imported = await importGpsRows(env, batch, createdByEmail);
    const archived = await archiveBatch(imported.archiveRows);
    if (
      Number(archived.archived) !== batch.rows.length ||
      Number(archived.deleted) !== batch.rows.length
    ) {
      throw new Error("gps_import_archive_incomplete");
    }
    imported.counts.archived = archived.archived;
    return finishGpsImportStep(env, job, imported.counts, {
      complete: !batch.hasMore,
      sourceRows: Number(archived.sourceRows || 0),
      backupRows: Number(archived.backupRows || 0),
    });
  } catch (error) {
    await failGpsImportStep(env, job, error);
    throw error;
  }
}
