import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "pages-dist");

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "_next"), { recursive: true });
await cp(
  path.join(root, ".next", "static"),
  path.join(output, "_next", "static"),
  { recursive: true },
);

const html = await readFile(
  path.join(root, ".next", "server", "app", "index.html"),
  "utf8",
);
await writeFile(path.join(output, "index.html"), html);
await writeFile(path.join(output, ".nojekyll"), "");
await writeFile(path.join(output, "404.html"), html);

console.log(`GitHub Pages artifact created at ${output}`);
