import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "script-src 'self' 'unsafe-inline'; connect-src 'self'",
          },
        ],
      },
    ];
  },
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
