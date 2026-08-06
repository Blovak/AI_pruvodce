import { build } from "esbuild";
import { webcrypto } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

try {
  const localEnvironment = await readFile(path.resolve(".env.local"), "utf8");
  for (const line of localEnvironment.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ||= value.replace(/\\n/g, "\n");
  }
} catch {
  // V CI lze všechny hodnoty dodat přímo přes prostředí.
}

const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "mistopis-firestore-migration-"),
);
const output = path.join(temporaryDirectory, "migration.mjs");

const configuredServiceAccount =
  process.env.FIREBASE_SERVICE_ACCOUNT_FILE ||
  path.resolve(".firebase-service-account.json");
try {
  await access(configuredServiceAccount);
  const serviceAccount = JSON.parse(
    await readFile(configuredServiceAccount, "utf8"),
  );
  process.env.FIREBASE_PROJECT_ID ||= serviceAccount.project_id;
  process.env.FIREBASE_CLIENT_EMAIL ||= serviceAccount.client_email;
  process.env.FIREBASE_PRIVATE_KEY ||= serviceAccount.private_key;
} catch (error) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) throw error;
}

try {
  await build({
    entryPoints: [path.resolve("scripts/firestore-migration.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  await import(pathToFileURL(output).href);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
