import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist");

await mkdir(path.join(output, ".openai"), { recursive: true });
await cp(
  path.join(root, ".openai", "hosting.json"),
  path.join(output, ".openai", "hosting.json"),
);
await cp(
  path.join(output, "server", "index.mjs"),
  path.join(output, "server", "index.js"),
);
await writeFile(
  path.join(output, "package.json"),
  JSON.stringify({ type: "module" }, null, 2),
);

console.log(`Sites artifact created at ${output}`);
