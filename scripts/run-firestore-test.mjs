import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "mistopis-firestore-test-"),
);
const output = path.join(temporaryDirectory, "test.mjs");

try {
  await build({
    entryPoints: [path.resolve("scripts/test-firestore.ts")],
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
