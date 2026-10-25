import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // No floating dev badge over the UI during live demos or in screenshots.
  devIndicators: false,
  partialPrefetching: true,
  transpilePackages: ["@vigil/contracts"],
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
