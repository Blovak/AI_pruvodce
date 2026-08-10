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

const serviceAccountFile =
  process.env.FIREBASE_SERVICE_ACCOUNT_FILE ||
  path.resolve(".firebase-service-account.json");
try {
  await access(serviceAccountFile);
  const serviceAccount = JSON.parse(await readFile(serviceAccountFile, "utf8"));
  process.env.FIREBASE_PROJECT_ID ||= serviceAccount.project_id;
  process.env.FIREBASE_CLIENT_EMAIL ||= serviceAccount.client_email;
  process.env.FIREBASE_PRIVATE_KEY ||= serviceAccount.private_key;
} catch (error) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) throw error;
}

const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "mistopis-position-owners-"),
);
const output = path.join(temporaryDirectory, "position-owners.mjs");

try {
  await build({
    entryPoints: [path.resolve("scripts/firestore-position-owners.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
  });
  await import(pathToFileURL(output).href);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
