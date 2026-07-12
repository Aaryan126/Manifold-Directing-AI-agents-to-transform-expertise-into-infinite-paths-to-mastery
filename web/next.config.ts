import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  transpilePackages: ["@coursefoundry/shared"],
};

export default nextConfig;
