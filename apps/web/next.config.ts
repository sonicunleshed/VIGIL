import type { NextConfig } from "next";
import { lanAddresses } from "./src/lib/lan";

// Where this server reaches the API. Phones on the LAN cannot reach the laptop's localhost:8000,
// so the patient check-in page talks to the API through this server instead.
const API_INTERNAL = process.env.VIGIL_API_INTERNAL ?? "http://127.0.0.1:8000";
// The value pattern matters: without one (or with a named group) Next copies the header into the
// forwarded URL's query string, which would put the secret code in access logs.
const WITH_CHECKIN_CODE = [{ type: "header" as const, key: "x-checkin-token", value: "[A-Za-z0-9_-]{20,}" }];

const nextConfig: NextConfig = {
  cacheComponents: true,
  // No floating dev badge over the UI during live demos or in screenshots.
  devIndicators: false,
  partialPrefetching: true,
  transpilePackages: ["@vigil/contracts"],
  // Let a phone on this machine's network load the check-in page from the dev server.
  allowedDevOrigins: lanAddresses(),
  async rewrites() {
    // Only the two check-in calls are forwarded, and only when they carry a check-in code.
    return [
      { source: "/api/checkin/session", has: WITH_CHECKIN_CODE, destination: `${API_INTERNAL}/api/checkin/session` },
      { source: "/api/symptom-reports", has: WITH_CHECKIN_CODE, destination: `${API_INTERNAL}/api/symptom-reports` },
    ];
  },
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
