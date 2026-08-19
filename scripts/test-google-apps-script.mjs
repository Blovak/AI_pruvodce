import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../google-apps-script/Code.js", import.meta.url),
  "utf8",
);

const context = vm.createContext({
  console,
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest(_algorithm, value) {
      return [...createHash("sha256").update(value, "utf8").digest()];
    },
    base64EncodeWebSafe(bytes) {
      return Buffer.from(bytes).toString("base64url");
    },
  },
});

vm.runInContext(
  `${source}\n` +
    `globalThis.__gpsBackupChecks = [\n` +
    `  gpsBackupRowMatches_([4833, 50, 14, "", "", "popis", true], [4833, 50, 14, "", "", "popis", "True"]),\n` +
    `  gpsBackupRowMatches_([4833, 50, 14, "", "", "jiný popis", true], [4833, 50, 14, "", "", "popis", "True"]),\n` +
    `  gpsBackupRowMatches_([4834, 50, 14, "", "", "popis", true], [4833, 50, 14, "", "", "popis", "True"]),\n` +
    `  gpsBackupRowMatches_([4833, 50, 14, "", "", "popis", false], [4833, 50, 14, "", "", "popis", "True"])\n` +
    `];\n` +
    `globalThis.__gpsImportReadBlocks = gpsImportReadBlocks_([10002, 3, 4, 5001, 5002, 10001]);`,
  context,
);

assert.deepEqual([...context.__gpsBackupChecks], [true, false, false, false]);
assert.deepEqual(
  Array.from(context.__gpsImportReadBlocks, (block) => ({ ...block })),
  [
    { start: 3, end: 5002 },
    { start: 10001, end: 10002 },
  ],
);
console.log("Google Apps Script tests passed.");
