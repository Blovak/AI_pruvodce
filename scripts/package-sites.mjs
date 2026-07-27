import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, ".open-next");
const output = path.join(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await mkdir(path.join(output, ".openai"), { recursive: true });
await cp(
  path.join(root, ".openai", "hosting.json"),
  path.join(output, ".openai", "hosting.json"),
);

console.log(`Sites artifact created at ${output}`);
