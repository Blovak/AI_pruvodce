import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../google-apps-script/Code.js", import.meta.url),
  "utf8",
);
const context = vm.createContext({ console, Date });
vm.runInContext(
  `${source}
globalThis.__cacheTest = {
  EARTH_RADIUS_METERS,
  findNearestValidCacheRow_,
  haversineMeters_,
};`,
  context,
);

const {
  EARTH_RADIUS_METERS,
  findNearestValidCacheRow_,
  haversineMeters_,
} = context.__cacheTest;
const now = Date.now();
const validUntil = new Date(now + 86_400_000);
const expiredAt = new Date(now - 86_400_000);

function row({
  key,
  latitude,
  longitude,
  valid = validUntil,
  guide = { placeName: key },
  audio = "",
}) {
  return [
    new Date(now),
    valid,
    key,
    latitude,
    longitude,
    key,
    JSON.stringify(guide),
    "",
    audio,
    "",
    "",
    new Date(now),
    0,
  ];
}

function sheet(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: () => ({ getValues: () => rows }),
  };
}

const latitude = 50;
const longitude = 14;
const degreesFor800Meters =
  (800 / EARTH_RADIUS_METERS) * (180 / Math.PI);

assert.ok(
  Math.abs(
    haversineMeters_(
      latitude,
      longitude,
      latitude + degreesFor800Meters,
      longitude,
    ) - 800,
  ) < 0.001,
);

const nearest = findNearestValidCacheRow_(
  sheet([
    row({ key: "far", latitude: 50.006, longitude }),
    row({ key: "near", latitude: 50.002, longitude }),
  ]),
  latitude,
  longitude,
  800,
  false,
);
assert.equal(nearest.values[2], "near");

const boundary = findNearestValidCacheRow_(
  sheet([
    row({
      key: "boundary",
      latitude: latitude + degreesFor800Meters,
      longitude,
    }),
  ]),
  latitude,
  longitude,
  800,
  false,
);
assert.equal(boundary.values[2], "boundary");

const outside = findNearestValidCacheRow_(
  sheet([
    row({
      key: "outside",
      latitude: latitude + degreesFor800Meters * 1.01,
      longitude,
    }),
  ]),
  latitude,
  longitude,
  800,
  false,
);
assert.equal(outside, null);

const filtered = findNearestValidCacheRow_(
  sheet([
    row({
      key: "expired",
      latitude: 50.0001,
      longitude,
      valid: expiredAt,
    }),
    row({
      key: "invalid-json",
      latitude: 50.0002,
      longitude,
      guide: undefined,
    }).map((value, index) => (index === 6 ? "{" : value)),
    row({ key: "valid", latitude: 50.0003, longitude }),
  ]),
  latitude,
  longitude,
  800,
  false,
);
assert.equal(filtered.values[2], "valid");

const audioOnly = findNearestValidCacheRow_(
  sheet([
    row({ key: "silent", latitude: 50.0001, longitude }),
    row({
      key: "with-audio",
      latitude: 50.0002,
      longitude,
      audio: "drive-file-id",
    }),
  ]),
  latitude,
  longitude,
  800,
  true,
);
assert.equal(audioOnly.values[2], "with-audio");

console.log("Cache radius tests passed.");
