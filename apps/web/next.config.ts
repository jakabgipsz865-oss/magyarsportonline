import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A packages/shared (és a Fázis 1+ során a packages/events, packages/db)
  // munkaterület-csomagokat forrásból transzpiláljuk, nem előre buildelt
  // dist-ből — ez a monorepo fejlesztési sebességéhez szükséges
  // (lásd docs/architecture/05-repo-structure.md).
  transpilePackages: ["@magyarsportonline/shared"],
};

export default nextConfig;
