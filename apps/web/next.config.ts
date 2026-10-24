import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the portal talks to the API only through /api/proxy (BFF)
  poweredByHeader: false,
  transpilePackages: ["@uni/shared"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
