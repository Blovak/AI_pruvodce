import assert from "node:assert/strict";

const nativeFetch = globalThis.fetch;
let deepSeekRequest;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith("https://cs.wikipedia.org/w/api.php")) {
    return Response.json({
      query: {
        pages: [
          {
            pageid: 1,
            index: 0,
            title: "Testovací místo",
            fullurl: "https://cs.wikipedia.org/wiki/Testovac%C3%AD_m%C3%ADsto",
            extract: "Testovací místo má doloženou místní historii.",
            coordinates: [{ lat: 50.0875, lon: 14.4213 }],
          },
          {
            pageid: 2,
            index: 1,
            title: "Blízká památka",
            fullurl: "https://cs.wikipedia.org/wiki/Bl%C3%ADzk%C3%A1_pam%C3%A1tka",
            extract: "Blízká památka je doloženým cílem v okolí.",
            coordinates: [{ lat: 50.089, lon: 14.424 }],
          },
        ],
      },
    });
  }

  if (url === "https://api.deepseek.com/chat/completions") {
    deepSeekRequest = JSON.parse(String(init.body));
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              placeName: "Testovací místo",
              subtitle: "Doložený příběh",
              era: "místní historie",
              overview: "Krátký ověřený úvod.",
              story:
                "Testovací příběh vychází pouze z dodaného podkladu a slouží k ověření datového toku. Popisuje místní prostředí střízlivě, bez vymyšlených osob, letopočtů nebo událostí. Zároveň zachovává požadovaný český jazyk a strukturu, kterou umí uživatelské rozhraní bezpečně zobrazit. V produkci budou na stejném místě použity skutečné blízké články české Wikipedie. Server jejich adresy doplní sám, takže model nemůže podstrčit nedůvěryhodný odkaz. Test také ověřuje tři stručné zajímavosti, doporučení v okolí a navazující otázku. Tím se kontroluje celá cesta od požadavku Workeru přes DeepSeek JSON režim až po normalizovanou odpověď pro klienta.",
              facts: [
                { title: "První fakt", text: "První doložená informace." },
                { title: "Druhý fakt", text: "Druhá doložená informace." },
                { title: "Třetí fakt", text: "Třetí doložená informace." },
              ],
              nearby: [{ sourceIndex: 2, kind: "památka" }],
              question: "Co vás zajímá dál?",
              sourceUrls: ["https://example.invalid/model-link"],
            }),
          },
        },
      ],
    });
  }

  return nativeFetch(input, init);
};

const worker = (await import("../dist/server/index.js")).default;
const context = { waitUntil() {} };
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
      label: "Testovací místo",
    }),
  }),
  { DEEPSEEK_API_KEY: "test-key" },
  context,
);
const guide = await response.json();

assert.equal(response.status, 200);
assert.equal(deepSeekRequest.model, "deepseek-v4-flash");
assert.deepEqual(deepSeekRequest.response_format, { type: "json_object" });
assert.match(deepSeekRequest.messages[1].content, /Testovací místo má doloženou/);
assert.deepEqual(guide.sourceUrls, [
  "https://cs.wikipedia.org/wiki/Testovac%C3%AD_m%C3%ADsto",
  "https://cs.wikipedia.org/wiki/Bl%C3%ADzk%C3%A1_pam%C3%A1tka",
]);
assert.equal(guide.facts.length, 3);
assert.deepEqual(guide.nearby, [
  {
    name: "Blízká památka",
    distance: "přibližně 250 m",
    kind: "památka",
    latitude: 50.089,
    longitude: 14.424,
  },
]);
assert.equal(guide.cache.hit, false);

const legacySpeech = await worker.fetch(
  new Request("https://worker.example/api/speech", {
    method: "POST",
  }),
  { DEEPSEEK_API_KEY: "test-key" },
  context,
);
assert.equal(legacySpeech.status, 404);

console.log("DeepSeek worker tests passed.");
