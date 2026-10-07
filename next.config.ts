import type { NextConfig } from "next";

// Static export for Firebase Hosting (free plan). All logic runs in the browser; Gemini via Firebase AI Logic.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BUILD_ID: String(Date.now()) },
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
