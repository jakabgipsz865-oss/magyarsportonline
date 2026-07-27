import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A workspace-csomagokat forrásból transzpiláljuk, nem előre buildelt
  // dist-ből — ez a monorepo fejlesztési sebességéhez szükséges
  // (lásd docs/architecture/05-repo-structure.md).
  transpilePackages: [
    "@magyarsportonline/shared",
    "@magyarsportonline/events",
    "@magyarsportonline/db",
    "@magyarsportonline/llm",
    "@magyarsportonline/observability",
    "@magyarsportonline/agents",
  ],
};

export default nextConfig;
