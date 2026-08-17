import assert from "node:assert/strict";
import worker from "../dist/server/index.js";

const env = {
  GOOGLE_LOG_URL: "https://storage.test/auth",
  GOOGLE_LOG_TOKEN: "server-secret",
};
const context = { waitUntil() {} };
const originalFetch = globalThis.fetch;
const deviceToken = "a".repeat(64);
const adminToken = "b".repeat(64);
let sessionRecordLogin = false;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === env.GOOGLE_LOG_URL) {
    const payload = JSON.parse(String(init.body || "{}"));
    assert.equal(payload.token, env.GOOGLE_LOG_TOKEN);
    if (payload.operation === "authRequestCode") {
      return Response.json({ ok: true, sent: true });
    }
    if (payload.operation === "authVerifyCode") {
      return Response.json({
        ok: true,
        verified: true,
        token: deviceToken,
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
    }
    if (payload.operation === "authSession") {
      if (payload.authToken === deviceToken) {
        sessionRecordLogin = payload.recordLogin === true;
      }
      return Response.json({
        ok: true,
        authenticated:
          payload.authToken === deviceToken || payload.authToken === adminToken,
        email:
          payload.authToken === adminToken
            ? "patrik.blovsky@gmail.com"
            : payload.authToken === deviceToken
              ? "test@example.com"
              : "",
      });
    }
    if (payload.operation === "authLogout") {
      return Response.json({ ok: true });
    }
    if (payload.event) {
      return Response.json({ ok: true });
    }
  }
  throw new Error(`Unexpected fetch: ${url}`);
};

try {
  const unauthorized = await worker.fetch(
    new Request("https://mistopis.test/api/geocode?lat=50&lon=14"),
    env,
    context,
  );
  assert.equal(unauthorized.status, 401);

  const invalidCode = await worker.fetch(
    new Request("https://mistopis.test/api/auth/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", code: "12345" }),
    }),
    env,
    context,
  );
  assert.equal(invalidCode.status, 400);

  const requested = await worker.fetch(
    new Request("https://mistopis.test/api/auth/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "Test@Example.com" }),
    }),
    env,
    context,
  );
  assert.equal(requested.status, 200);
  assert.deepEqual(await requested.json(), {
    sent: true,
    email: "test@example.com",
  });

  const verified = await worker.fetch(
    new Request("https://mistopis.test/api/auth/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", code: "123456" }),
    }),
    env,
    context,
  );
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).token, deviceToken);

  const session = await worker.fetch(
    new Request("https://mistopis.test/api/auth/session", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    }),
    env,
    context,
  );
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    user: { email: "test@example.com" },
  });
  assert.equal(sessionRecordLogin, true);

  const forbiddenAdmin = await worker.fetch(
    new Request("https://mistopis.test/api/admin/stats", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    }),
    env,
    context,
  );
  assert.equal(forbiddenAdmin.status, 403);

  const firestoreRequired = await worker.fetch(
    new Request("https://mistopis.test/api/admin/stats", {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),
    env,
    context,
  );
  assert.equal(firestoreRequired.status, 503);

  const forbiddenImport = await worker.fetch(
    new Request("https://mistopis.test/api/admin/gps-import", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    }),
    env,
    context,
  );
  assert.equal(forbiddenImport.status, 403);

  const firestoreImportRequired = await worker.fetch(
    new Request("https://mistopis.test/api/admin/gps-import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reset: true }),
    }),
    env,
    context,
  );
  assert.equal(firestoreImportRequired.status, 503);

  console.log("Email authentication worker tests passed.");
} finally {
  globalThis.fetch = originalFetch;
}
