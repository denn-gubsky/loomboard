import { defineConfig } from "vitest/config";
import type { PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { createProxyMiddleware } from "http-proxy-middleware";

// Fallback proxy target when the client doesn't name one (blank Base URL).
const defaultTarget = process.env.LOOMBOARD_PROXY_TARGET ?? "http://127.0.0.1:8787";

// Dev-only dynamic proxy. The SPA always calls same-origin `/v1/*` and names the
// loomcycle to reach via the `x-loomcycle-target` header (set from the
// connection screen's Base URL). The proxy routes each request to that target —
// so you can point loomboard at any reachable runtime (local, a LAN box like
// TrueNAS, or remote) from the UI with NO CORS and NO restart. Blank Base URL →
// defaultTarget. In a production build there is no proxy: the client then talks
// to the Base URL directly, which requires CORS or a same-origin reverse proxy.
function dynamicLoomcycleProxy(): PluginOption {
  return {
    name: "loomboard-dynamic-proxy",
    configureServer(server) {
      const proxy = createProxyMiddleware({
        target: defaultTarget,
        changeOrigin: true,
        secure: false,
        pathFilter: (path) => path.startsWith("/v1"),
        router: (req) => {
          const t = req.headers["x-loomcycle-target"];
          const target = Array.isArray(t) ? t[0] : t;
          return target || undefined;
        },
      });
      server.middlewares.use(proxy);
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Keep default base "/": Tauri serves the built assets from its protocol root,
  // so the absolute /assets/* paths resolve. (Fallback if a packaged build 404s
  // on assets: set base "./" for mode === "tauri" — safe, there's no router.)
  plugins: [react(), dynamicLoomcycleProxy()],
  // `tauri dev` loads the app from this dev server, so the port must match
  // devUrl in tauri.conf.json. Only pin it for the Tauri build to avoid forcing
  // strictPort on the ordinary `npm run dev` workflow.
  ...(mode === "tauri"
    ? { clearScreen: false, server: { port: 5173, strictPort: true } }
    : {}),
  test: {
    // Pure reducer/metrics tests run in node.
    environment: "node",
  },
}));
