import assert from "node:assert/strict";
import { generateKeyPairSync, webcrypto } from "node:crypto";
import {
  authenticateSession,
  findCachedGuide,
  getAdminStats,
  prepareAuthCode,
  revokeSession,
  saveAnalyticsEvent,
  saveCachedGuide,
  verifyAuthCode,
} from "../lib/firestore-storage";

Object.defineProperty(globalThis, "crypto", { value: webcrypto });

type Fields = Record<string, Record<string, unknown>>;
const documents = new Map<string, Fields>();
let transactionNumber = 0;

function decode(value: Record<string, unknown>): unknown {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    const array = value.arrayValue as { values?: Record<string, unknown>[] };
    return (array.values || []).map(decode);
  }
  if ("mapValue" in value) {
    const map = value.mapValue as { fields?: Fields };
    return Object.fromEntries(
      Object.entries(map.fields || {}).map(([key, field]) => [key, decode(field)]),
    );
  }
  return null;
}

function decodedFields(fields: Fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decode(value)]),
  );
}

function document(path: string, fields: Fields) {
  return {
    name: `projects/test-project/databases/(default)/documents/${path}`,
    fields,
    createTime: "2026-08-06T00:00:00.000Z",
    updateTime: new Date().toISOString(),
  };
}

function pathFromUrl(url: URL) {
  const marker = "/documents/";
  const start = url.pathname.indexOf(marker);
  return decodeURI(url.pathname.slice(start + marker.length));
}

function matchesFilter(data: Record<string, unknown>, filter: Record<string, any>): boolean {
  if (filter.compositeFilter) {
    return filter.compositeFilter.filters.every((entry: Record<string, any>) =>
      matchesFilter(data, entry),
    );
  }
  const field = filter.fieldFilter.field.fieldPath;
  const actual = data[field];
  const expected = decode(filter.fieldFilter.value);
  switch (filter.fieldFilter.op) {
    case "EQUAL":
      return actual === expected;
    case "GREATER_THAN_OR_EQUAL":
      return String(actual) >= String(expected);
    case "LESS_THAN_OR_EQUAL":
      return String(actual) <= String(expected);
    default:
      return false;
  }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.href === "https://oauth2.googleapis.com/token") {
    return Response.json({ access_token: "test-oauth-token", expires_in: 3600 });
  }
  if (url.hostname !== "firestore.googleapis.com") {
    throw new Error(`Unexpected fetch: ${url}`);
  }
  assert.equal(
    (init.headers as Record<string, string>).Authorization,
    "Bearer test-oauth-token",
  );
  if (url.pathname.endsWith("/documents:beginTransaction")) {
    return Response.json({ transaction: `tx-${++transactionNumber}` });
  }
  if (url.pathname.endsWith("/documents:rollback")) {
    return Response.json({});
  }
  if (url.pathname.endsWith("/documents:commit")) {
    const body = JSON.parse(String(init.body));
    for (const write of body.writes || []) {
      const path = write.update.name.split("/documents/")[1];
      documents.set(path, write.update.fields);
    }
    return Response.json({ writeResults: [] });
  }
  if (url.pathname.endsWith("/documents:runQuery")) {
    const body = JSON.parse(String(init.body));
    const collection = body.structuredQuery.from[0].collectionId;
    const rows = [...documents.entries()]
      .filter(([path]) => path.startsWith(`${collection}/`))
      .filter(([, fields]) =>
        body.structuredQuery.where
          ? matchesFilter(decodedFields(fields), body.structuredQuery.where)
          : true,
      )
      .slice(0, body.structuredQuery.limit || undefined)
      .map(([path, fields]) => ({ document: document(path, fields) }));
    return Response.json(rows);
  }
  if (init.method === "POST") {
    const collection = pathFromUrl(url);
    const id = url.searchParams.get("documentId");
    const body = JSON.parse(String(init.body));
    documents.set(`${collection}/${id}`, body.fields);
    return Response.json(document(`${collection}/${id}`, body.fields));
  }
  const path = pathFromUrl(url);
  if (init.method === "PATCH") {
    const body = JSON.parse(String(init.body));
    documents.set(path, body.fields);
    return Response.json(document(path, body.fields));
  }
  const fields = documents.get(path);
  return fields
    ? Response.json(document(path, fields))
    : Response.json({ error: "not found" }, { status: 404 });
};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  FIREBASE_PROJECT_ID: "test-project",
  FIREBASE_CLIENT_EMAIL: "firestore@test-project.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  AUTH_SECRET: "test-auth-secret-with-sufficient-entropy",
};

try {
  const email = "test@example.com";
  const code = await prepareAuthCode(env, email);
  assert.match(code, /^\d{6}$/);

  const invalid = await verifyAuthCode(env, email, "999999" === code ? "999998" : "999999");
  assert.deepEqual(invalid, { verified: false, error: "invalid_code" });

  const verified = await verifyAuthCode(env, email, code);
  assert.equal(verified.verified, true);
  assert.match(verified.token || "", /^[A-Za-z0-9_-]{64}$/);
  const session = await authenticateSession(env, verified.token || "");
  assert.equal(session?.email, email);
  await revokeSession(env, verified.token || "");
  assert.equal(await authenticateSession(env, verified.token || ""), null);

  await saveCachedGuide(env, {
    cacheKey: "50.0875,14.4213",
    latitude: 50.0875,
    longitude: 14.4213,
    place: "Staroměstské náměstí",
    guide: { placeName: "Staroměstské náměstí" },
    textModel: "deepseek-v4-flash:nearby-directions-v1",
    createdByEmail: email,
  });
  const cached = await findCachedGuide(env, {
    cacheKey: "50.0875,14.4213",
    requiredModelPrefix: "deepseek-v4-flash:nearby-directions-v1",
  });
  assert.equal(cached?.guide.placeName, "Staroměstské náměstí");

  await saveAnalyticsEvent(env, {
    action: "guide",
    status: 200,
    questionLength: 0,
    userEmail: email,
  });
  await saveAnalyticsEvent(env, {
    action: "guide",
    status: 200,
    questionLength: 42,
    userEmail: email,
  });
  assert.ok([...documents.keys()].some((path) => path.startsWith("usageEvents/")));
  const adminStats = await getAdminStats(env);
  assert.equal(adminStats.users.length, 1);
  assert.equal(adminStats.users[0].email, email);
  assert.ok(Date.parse(adminStats.users[0].lastLoginAt) > 0);
  assert.equal(adminStats.positionLookups, 1);
  assert.equal(adminStats.users[0].newPositions, 1);
  console.log("Firestore storage tests passed.");
} finally {
  globalThis.fetch = originalFetch;
}
