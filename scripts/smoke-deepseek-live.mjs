import assert from "node:assert/strict";

const apiKey = process.env.DEEPSEEK_API_KEY;
assert(apiKey, "Chybí DEEPSEEK_API_KEY.");

const worker = (await import("../dist/server/index.js")).default;
const response = await worker.fetch(
  new Request("https://worker.example/api/guide", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      latitude: 50.0875,
      longitude: 14.4213,
      label: "Staroměstské náměstí, Praha",
    }),
  }),
  {
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  },
  { waitUntil() {} },
);
const payload = await response.json();

if (!response.ok) {
  throw new Error(payload.error || `HTTP ${response.status}`);
}

assert.equal(payload.facts?.length, 3);
assert(payload.story);
assert(payload.sourceUrls?.length > 0);
assert(
  payload.nearby?.length > 0,
  `Výklad neobsahuje směrové cíle: ${JSON.stringify(payload.nearby)}`,
);
assert(
  payload.nearby.every(
    (item) =>
      Number.isFinite(item.latitude) && Number.isFinite(item.longitude),
  ),
);
console.log(
  `DeepSeek live smoke test passed: ${payload.placeName}, ${payload.sourceUrls.length} zdrojů, ${payload.nearby.length} směrových cílů.`,
);
