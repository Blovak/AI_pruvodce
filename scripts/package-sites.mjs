import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist");

await mkdir(path.join(output, ".openai"), { recursive: true });
await cp(
  path.join(root, ".openai", "hosting.json"),
  path.join(output, ".openai", "hosting.json"),
);

console.log(`Sites artifact created at ${output}`);
