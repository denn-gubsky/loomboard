import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev proxy: the SPA calls same-origin `/v1/*`, Vite forwards to the local
// loomcycle runtime so the browser never makes a cross-origin request (no CORS
// dance in dev). Override the target with LOOMBOARD_PROXY_TARGET if loomcycle
// listens elsewhere. In production the SPA talks to whatever base URL the user
// configures in the connection settings — this proxy is dev-only.
const proxyTarget = process.env.LOOMBOARD_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v1": { target: proxyTarget, changeOrigin: true },
    },
  },
  test: {
    // Pure reducer/metrics tests run in node. Component tests can opt into
    // jsdom per-file via a `// @vitest-environment jsdom` pragma once added.
    environment: "node",
  },
});
