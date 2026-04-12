import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const isExport = process.env.STATIC_EXPORT === "true";

const isPagesDeployment = process.env.GITHUB_PAGES === "true";
const repoName = process.env.REPO_NAME || "";

const nextConfig: NextConfig = {
  ...(isExport ? { output: "export" } : {}),
  ...(isPagesDeployment && repoName ? { basePath: `/${repoName}` } : {}),
  reactCompiler: true,
  images: { unoptimized: true },
  turbopack: {},
};

export default withPWA({
  dest: "public",
  register: true,
})(nextConfig);
