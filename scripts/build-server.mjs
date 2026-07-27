import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const output = path.join(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "server"), { recursive: true });
await mkdir(path.join(output, ".openai"), { recursive: true });

await build({
  entryPoints: [path.join(root, "server", "index.ts")],
  outfile: path.join(output, "server", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  sourcemap: false,
});

await cp(
  path.join(root, ".openai", "hosting.json"),
  path.join(output, ".openai", "hosting.json"),
);

console.log(`Standalone server artifact created at ${output}`);
