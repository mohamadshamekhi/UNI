import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the backoffice is fully behind auth and talks to the API through /api/proxy
  poweredByHeader: false,
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
