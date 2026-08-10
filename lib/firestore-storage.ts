import {
  distanceBetween,
  geohashForLocation,
  geohashQueryBounds,
} from "geofire-common";
import {
  createDocument,
  FirestoreEnv,
  getDocument,
  hmacSha256,
  queryDocuments,
  randomId,
  runTransaction,
  setDocument,
  sha256,
} from "./firestore-rest";

export type StorageEnv = FirestoreEnv & {
  AUTH_SECRET?: string;
};

export type StoredAuthResult = {
  authenticated?: boolean;
  email?: string;
  sent?: boolean;
  verified?: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
  retryAfterSeconds?: number;
};

export type StoredGuide = {
  guide: Record<string, unknown>;
  cacheKey: string;
  distanceMeters: number;
};

type AuthCode = {
  email: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  used: boolean;
  requestTimes: string[];
};

type AuthSession = {
  email: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  revoked: boolean;
};

type User = {
  email: string;
  createdAt: string;
  lastLoginAt: string;
  status: string;
};

export type AdminUser = {
  email: string;
  createdAt: string;
  lastLoginAt: string;
  status: string;
  newPositions: number;
};

export type AdminStats = {
  users: AdminUser[];
  positionLookups: number;
};

type GuideCache = {
  cacheKey: string;
  latitude: number;
  longitude: number;
  geohash: string;
  place: string;
  guide: Record<string, unknown>;
  textModel: string;
  createdAt: string;
  validUntil: string;
  lastUsedAt: string;
  hits: number;
  mp3Url?: string;
  driveFileId?: string;
  voiceModel?: string;
  createdByEmail?: string;
};

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_RATE_LIMIT = 3;
const GLOBAL_RATE_LIMIT = 60;
const CODE_ATTEMPT_LIMIT = 5;

export class AuthRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("auth_rate_limited");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function authSecret(env: StorageEnv) {
  const value = String(env.AUTH_SECRET || "");
  if (!value) throw new Error("auth_secret_missing");
  return value;
}

function validDate(value: unknown) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function recentTimes(values: unknown, now: number) {
  return (Array.isArray(values) ? values : [])
    .map(validDate)
    .filter((time) => time > now - RATE_WINDOW_MS && time <= now)
    .map((time) => new Date(time).toISOString());
}

function retryAfter(times: string[], now: number) {
  const oldest = Math.min(...times.map((value) => Date.parse(value)));
  return Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000));
}

function randomCode() {
  const maximum = 0x1_0000_0000;
  const accepted = maximum - (maximum % 1_000_000);
  let value = maximum;
  while (value >= accepted) {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return String(value % 1_000_000).padStart(6, "0");
}

async function emailDocumentId(env: StorageEnv, email: string) {
  return hmacSha256(authSecret(env), `email:${email}`);
}

async function userDocumentId(env: StorageEnv, email: string) {
  return hmacSha256(authSecret(env), `user:${email}`);
}

async function sessionDocumentId(env: StorageEnv, token: string) {
  return hmacSha256(authSecret(env), `session:${token}`);
}

export async function prepareAuthCode(env: StorageEnv, email: string) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const emailId = await emailDocumentId(env, email);
  const code = randomCode();
  const codeHash = await hmacSha256(
    authSecret(env),
    `code:${email}:${code}`,
  );

  await runTransaction(env, async (transaction) => {
    const [existingCode, globalRate] = await Promise.all([
      transaction.get<AuthCode>(`authCodes/${emailId}`),
      transaction.get<{ requestTimes?: string[] }>("authMeta/globalRate"),
    ]);
    const emailTimes = recentTimes(existingCode?.data.requestTimes, now);
    const globalTimes = recentTimes(globalRate?.data.requestTimes, now);
    if (emailTimes.length >= EMAIL_RATE_LIMIT) {
      throw new AuthRateLimitError(retryAfter(emailTimes, now));
    }
    if (globalTimes.length >= GLOBAL_RATE_LIMIT) {
      throw new AuthRateLimitError(retryAfter(globalTimes, now));
    }

    transaction.set(`authCodes/${emailId}`, {
      email,
      codeHash,
      createdAt: nowIso,
      expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0,
      used: false,
      requestTimes: [...emailTimes, nowIso],
    });
    transaction.set("authMeta/globalRate", {
      requestTimes: [...globalTimes, nowIso],
      updatedAt: nowIso,
    });
  });

  return code;
}

export async function verifyAuthCode(
  env: StorageEnv,
  email: string,
  code: string,
) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const emailId = await emailDocumentId(env, email);
  const userId = await userDocumentId(env, email);
  const suppliedHash = await hmacSha256(
    authSecret(env),
    `code:${email}:${code}`,
  );
  const token = randomId(48);
  const sessionId = await sessionDocumentId(env, token);
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();

  const result = await runTransaction(env, async (transaction) => {
    const [storedCode, existingUser] = await Promise.all([
      transaction.get<AuthCode>(`authCodes/${emailId}`),
      transaction.get<User>(`users/${userId}`),
    ]);
    const authCode = storedCode?.data;
    if (!authCode || authCode.used || validDate(authCode.expiresAt) <= now) {
      return { verified: false, error: "invalid_code" };
    }
    if (Number(authCode.attempts) >= CODE_ATTEMPT_LIMIT) {
      return { verified: false, error: "too_many_attempts" };
    }

    const attempts = Number(authCode.attempts) + 1;
    if (authCode.codeHash !== suppliedHash) {
      transaction.set(`authCodes/${emailId}`, {
        ...authCode,
        attempts,
      });
      return {
        verified: false,
        error:
          attempts >= CODE_ATTEMPT_LIMIT
            ? "too_many_attempts"
            : "invalid_code",
      };
    }

    transaction.set(`authCodes/${emailId}`, {
      ...authCode,
      attempts,
      used: true,
    });
    transaction.set(`authSessions/${sessionId}`, {
      email,
      createdAt: nowIso,
      expiresAt,
      lastUsedAt: nowIso,
      revoked: false,
    });
    transaction.set(`users/${userId}`, {
      email,
      createdAt: existingUser?.data.createdAt || nowIso,
      lastLoginAt: nowIso,
      status: "aktivní",
    });
    return { verified: true, token, expiresAt };
  });

  return result;
}

export async function authenticateSession(env: StorageEnv, token: string) {
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(token)) return null;
  const sessionId = await sessionDocumentId(env, token);
  const session = await getDocument<AuthSession>(
    env,
    `authSessions/${sessionId}`,
  );
  if (
    !session ||
    session.data.revoked ||
    validDate(session.data.expiresAt) <= Date.now()
  ) {
    return null;
  }
  return { id: sessionId, ...session.data };
}

export async function touchSession(
  env: StorageEnv,
  session: AuthSession & { id: string },
) {
  if (Date.now() - validDate(session.lastUsedAt) < 24 * 60 * 60 * 1000) {
    return;
  }
  const { id, ...storedSession } = session;
  await setDocument(env, `authSessions/${id}`, {
    ...storedSession,
    lastUsedAt: new Date().toISOString(),
  });
}

export async function revokeSession(env: StorageEnv, token: string) {
  const session = await authenticateSession(env, token);
  if (!session) return;
  const { id, ...storedSession } = session;
  await setDocument(env, `authSessions/${id}`, {
    ...storedSession,
    revoked: true,
  });
}

function validGuide(entry: GuideCache, requiredModelPrefix: string) {
  return (
    validDate(entry.validUntil) > Date.now() &&
    (!requiredModelPrefix || entry.textModel.startsWith(requiredModelPrefix)) &&
    entry.guide &&
    typeof entry.guide === "object" &&
    !Array.isArray(entry.guide)
  );
}

export async function findCachedGuide(
  env: StorageEnv,
  request: {
    cacheKey: string;
    latitude?: number;
    longitude?: number;
    maxDistanceMeters?: number;
    requiredModelPrefix: string;
  },
) {
  let candidates: Array<{
    id: string;
    data: GuideCache;
    distanceMeters: number;
  }> = [];

  if (
    Number.isFinite(request.latitude) &&
    Number.isFinite(request.longitude) &&
    Number(request.maxDistanceMeters) > 0
  ) {
    const center: [number, number] = [
      Number(request.latitude),
      Number(request.longitude),
    ];
    const radius = Math.min(Number(request.maxDistanceMeters), 5000);
    const bounds = geohashQueryBounds(center, radius);
    const results = await Promise.all(
      bounds.map(([start, end]) =>
        queryDocuments<GuideCache>(env, "guideCache", {
          filter: {
            composite: "AND",
            filters: [
              { field: "geohash", op: "GREATER_THAN_OR_EQUAL", value: start },
              { field: "geohash", op: "LESS_THAN_OR_EQUAL", value: end },
            ],
          },
          limit: 100,
        }),
      ),
    );
    const unique = new Map(
      results.flat().map((record) => [record.id, record]),
    );
    candidates = [...unique.values()].map((record) => ({
      id: record.id,
      data: record.data,
      distanceMeters:
        distanceBetween(center, [record.data.latitude, record.data.longitude]) *
        1000,
    }));
  } else {
    const results = await queryDocuments<GuideCache>(env, "guideCache", {
      filter: { field: "cacheKey", op: "EQUAL", value: request.cacheKey },
      limit: 100,
    });
    candidates = results.map((record) => ({
      id: record.id,
      data: record.data,
      distanceMeters: 0,
    }));
  }

  const maximum = Number(request.maxDistanceMeters) || 0;
  const match = candidates
    .filter(
      (candidate) =>
        validGuide(candidate.data, request.requiredModelPrefix) &&
        (!maximum || candidate.distanceMeters <= maximum + 0.01),
    )
    .sort((left, right) => {
      if (left.distanceMeters !== right.distanceMeters) {
        return left.distanceMeters - right.distanceMeters;
      }
      return validDate(right.data.createdAt) - validDate(left.data.createdAt);
    })[0];
  if (!match) return null;

  return {
    id: match.id,
    data: match.data,
    guide: match.data.guide,
    cacheKey: match.data.cacheKey,
    distanceMeters: Math.round(match.distanceMeters),
  };
}

export async function touchCachedGuide(
  env: StorageEnv,
  match: { id: string; data: GuideCache },
) {
  await setDocument(env, `guideCache/${match.id}`, {
    ...match.data,
    lastUsedAt: new Date().toISOString(),
    hits: Number(match.data.hits || 0) + 1,
  });
}

export async function saveCachedGuide(
  env: StorageEnv,
  value: {
    cacheKey: string;
    latitude: number;
    longitude: number;
    place: string;
    guide: Record<string, unknown>;
    textModel: string;
    createdByEmail: string;
  },
) {
  const now = new Date();
  const validUntil = new Date(now.getTime());
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  const data: GuideCache = {
    ...value,
    geohash: geohashForLocation([value.latitude, value.longitude]),
    createdAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    lastUsedAt: now.toISOString(),
    hits: 0,
  };
  const id = `${await sha256(`${value.cacheKey}:${value.textModel}`)}-${randomId(6)}`;
  await createDocument(env, "guideCache", id, data);
  return { cacheKey: value.cacheKey, validUntil: data.validUntil };
}

export async function saveAnalyticsEvent(
  env: StorageEnv,
  event: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString();
  const id = `${timestamp.replace(/\D/g, "")}-${randomId(8)}`;
  await createDocument(env, "usageEvents", id, { timestamp, ...event });
  if (Number(event.status) >= 400) {
    await createDocument(env, "errorEvents", id, {
      timestamp,
      session: event.session || "",
      action: event.action || "unknown",
      status: Number(event.status) || 0,
      place: event.place || "",
      error: event.detail || "Požadavek skončil chybou.",
    });
  }
}

export async function getAdminStats(env: StorageEnv): Promise<AdminStats> {
  const [userRecords, positions, sessions] = await Promise.all([
    queryDocuments<User>(env, "users"),
    queryDocuments<GuideCache>(env, "guideCache"),
    queryDocuments<AuthSession>(env, "authSessions"),
  ]);

  const positionsByUser = new Map<string, number>();
  for (const { data } of positions) {
    const email = String(data.createdByEmail || "").trim().toLowerCase();
    if (email) {
      positionsByUser.set(email, (positionsByUser.get(email) || 0) + 1);
    }
  }

  const lastLoginByUser = new Map<string, string>();
  for (const { data } of sessions) {
    const email = String(data.email || "").trim().toLowerCase();
    const createdAt = String(data.createdAt || "");
    if (
      email &&
      validDate(createdAt) > validDate(lastLoginByUser.get(email))
    ) {
      lastLoginByUser.set(email, createdAt);
    }
  }

  const users = userRecords
    .map(({ data }) => ({
      email: String(data.email || ""),
      createdAt: String(data.createdAt || ""),
      lastLoginAt:
        lastLoginByUser.get(String(data.email || "").toLowerCase()) ||
        String(data.lastLoginAt || ""),
      status: String(data.status || ""),
      newPositions:
        positionsByUser.get(String(data.email || "").toLowerCase()) || 0,
    }))
    .filter((user) => user.email)
    .sort(
      (left, right) =>
        validDate(right.lastLoginAt) - validDate(left.lastLoginAt),
    );
  return { users, positionLookups: positions.length };
}
