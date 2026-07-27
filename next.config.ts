import type { NextConfig } from "next";
import path from "node:path";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd()),
  basePath: isGitHubPages ? "/AI_pruvodce" : "",
  assetPrefix: isGitHubPages ? "/AI_pruvodce" : "",
};

export default nextConfig;
