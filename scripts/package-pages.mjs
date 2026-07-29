import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const output = path.join(root, "pages-dist");
const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "assets"), { recursive: true });

await build({
  entryPoints: {
    app: path.join(root, "client", "index.tsx"),
  },
  outdir: path.join(output, "assets"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  assetNames: "images/[name]-[hash]",
  loader: {
    ".png": "file",
  },
  define: {
    "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify(apiBaseUrl),
  },
});

await cp(path.join(root, "index.html"), path.join(output, "index.html"));
await cp(
  path.join(root, "manifest.webmanifest"),
  path.join(output, "manifest.webmanifest"),
);
await writeFile(path.join(output, ".nojekyll"), "");
await cp(path.join(root, "index.html"), path.join(output, "404.html"));

console.log(`GitHub Pages artifact created at ${output}`);
