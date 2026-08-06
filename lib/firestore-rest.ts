export type FirestoreEnv = {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
};

type FirestoreValue = Record<string, unknown>;

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};

type TokenCache = {
  key: string;
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlText(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemBytes(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function requireConfig(env: FirestoreEnv) {
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(env.FIREBASE_PRIVATE_KEY || "").trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("firestore_not_configured");
  }
  return { projectId, clientEmail, privateKey };
}

async function accessToken(env: FirestoreEnv) {
  const config = requireConfig(env);
  const cacheKey = `${config.projectId}:${config.clientEmail}`;
  if (
    tokenCache?.key === cacheKey &&
    tokenCache.expiresAt > Date.now() + 60_000
  ) {
    return tokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlText({ alg: "RS256", typ: "JWT" })}.${base64UrlText({
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`firestore_oauth_http_${response.status}`);
  }
  const result = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!result.access_token) throw new Error("firestore_oauth_missing_token");
  tokenCache = {
    key: cacheKey,
    token: result.access_token,
    expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000,
  };
  return result.access_token;
}

export function firestoreConfigured(env: FirestoreEnv) {
  return Boolean(
    env.FIREBASE_PROJECT_ID &&
      env.FIREBASE_CLIENT_EMAIL &&
      env.FIREBASE_PRIVATE_KEY,
  );
}

function databaseRoot(env: FirestoreEnv) {
  const { projectId } = requireConfig(env);
  return `projects/${projectId}/databases/(default)`;
}

function apiRoot(env: FirestoreEnv) {
  return `https://firestore.googleapis.com/v1/${databaseRoot(env)}`;
}

async function firestoreFetch(
  env: FirestoreEnv,
  path: string,
  init: RequestInit = {},
) {
  const token = await accessToken(env);
  return fetch(`${apiRoot(env)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: encodeFields(value as Record<string, unknown>),
      },
    };
  }
  return { stringValue: String(value) };
}

function encodeFields(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, encodeValue(field)]),
  );
}

function decodeValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return String(value.timestampValue);
  if ("arrayValue" in value) {
    const array = value.arrayValue as { values?: FirestoreValue[] };
    return (array.values || []).map(decodeValue);
  }
  if ("mapValue" in value) {
    const map = value.mapValue as {
      fields?: Record<string, FirestoreValue>;
    };
    return decodeFields(map.fields || {});
  }
  if ("geoPointValue" in value) return value.geoPointValue;
  return null;
}

function decodeFields(fields: Record<string, FirestoreValue>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

function decodeDocument<T>(document: FirestoreDocument) {
  return {
    id: document.name.split("/").pop() || "",
    name: document.name,
    createTime: document.createTime,
    updateTime: document.updateTime,
    data: decodeFields(document.fields || {}) as T,
  };
}

function documentName(env: FirestoreEnv, path: string) {
  return `${databaseRoot(env)}/documents/${path}`;
}

export type FirestoreRecord<T> = ReturnType<typeof decodeDocument<T>>;

export async function getDocument<T>(env: FirestoreEnv, path: string) {
  const response = await firestoreFetch(
    env,
    `/documents/${encodeURI(path)}`,
    { method: "GET" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`firestore_get_http_${response.status}`);
  return decodeDocument<T>((await response.json()) as FirestoreDocument);
}

export async function setDocument(
  env: FirestoreEnv,
  path: string,
  data: Record<string, unknown>,
) {
  const response = await firestoreFetch(
    env,
    `/documents/${encodeURI(path)}`,
    { method: "PATCH", body: JSON.stringify({ fields: encodeFields(data) }) },
  );
  if (!response.ok) throw new Error(`firestore_set_http_${response.status}`);
  return decodeDocument((await response.json()) as FirestoreDocument);
}

export async function createDocument(
  env: FirestoreEnv,
  collection: string,
  documentId: string,
  data: Record<string, unknown>,
) {
  const params = new URLSearchParams({ documentId });
  const response = await firestoreFetch(
    env,
    `/documents/${encodeURI(collection)}?${params}`,
    { method: "POST", body: JSON.stringify({ fields: encodeFields(data) }) },
  );
  if (!response.ok) throw new Error(`firestore_create_http_${response.status}`);
  return decodeDocument((await response.json()) as FirestoreDocument);
}

type Filter =
  | { field: string; op: string; value: unknown }
  | { composite: "AND" | "OR"; filters: Filter[] };

function encodeFilter(filter: Filter): Record<string, unknown> {
  if ("composite" in filter) {
    return {
      compositeFilter: {
        op: filter.composite,
        filters: filter.filters.map(encodeFilter),
      },
    };
  }
  return {
    fieldFilter: {
      field: { fieldPath: filter.field },
      op: filter.op,
      value: encodeValue(filter.value),
    },
  };
}

export async function queryDocuments<T>(
  env: FirestoreEnv,
  collection: string,
  options: {
    filter?: Filter;
    orderBy?: Array<{ field: string; direction?: "ASCENDING" | "DESCENDING" }>;
    limit?: number;
  } = {},
) {
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: collection }],
  };
  if (options.filter) structuredQuery.where = encodeFilter(options.filter);
  if (options.orderBy?.length) {
    structuredQuery.orderBy = options.orderBy.map((order) => ({
      field: { fieldPath: order.field },
      direction: order.direction || "ASCENDING",
    }));
  }
  if (options.limit) structuredQuery.limit = options.limit;
  const response = await firestoreFetch(env, "/documents:runQuery", {
    method: "POST",
    body: JSON.stringify({ structuredQuery }),
  });
  if (!response.ok) throw new Error(`firestore_query_http_${response.status}`);
  const rows = (await response.json()) as Array<{
    document?: FirestoreDocument;
  }>;
  return rows
    .filter((row): row is { document: FirestoreDocument } => Boolean(row.document))
    .map((row) => decodeDocument<T>(row.document));
}

export type TransactionDocument<T> = FirestoreRecord<T> | null;

export async function runTransaction<T>(
  env: FirestoreEnv,
  handler: (transaction: {
    get<U>(path: string): Promise<TransactionDocument<U>>;
    set(path: string, data: Record<string, unknown>): void;
  }) => Promise<T>,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const begin = await firestoreFetch(env, "/documents:beginTransaction", {
      method: "POST",
      body: "{}",
    });
    if (!begin.ok) throw new Error(`firestore_begin_http_${begin.status}`);
    const { transaction } = (await begin.json()) as { transaction: string };
    const writes: Array<Record<string, unknown>> = [];
    try {
      const result = await handler({
        async get<U>(path: string) {
          const params = new URLSearchParams({ transaction });
          const response = await firestoreFetch(
            env,
            `/documents/${encodeURI(path)}?${params}`,
            { method: "GET" },
          );
          if (response.status === 404) return null;
          if (!response.ok) {
            throw new Error(`firestore_transaction_get_http_${response.status}`);
          }
          return decodeDocument<U>((await response.json()) as FirestoreDocument);
        },
        set(path, data) {
          writes.push({
            update: {
              name: documentName(env, path),
              fields: encodeFields(data),
            },
          });
        },
      });
      const commit = await firestoreFetch(env, "/documents:commit", {
        method: "POST",
        body: JSON.stringify({ transaction, writes }),
      });
      if (commit.ok) return result;
      if ((commit.status === 409 || commit.status === 412) && attempt < 4) {
        continue;
      }
      throw new Error(`firestore_commit_http_${commit.status}`);
    } catch (error) {
      try {
        await firestoreFetch(env, "/documents:rollback", {
          method: "POST",
          body: JSON.stringify({ transaction }),
        });
      } catch {
        // Původní chyba je pro volajícího důležitější než neúspěšný rollback.
      }
      throw error;
    }
  }
  throw new Error("firestore_transaction_retries_exhausted");
}

export function randomId(byteLength = 18) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64Url(bytes);
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

export async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(signature));
}
