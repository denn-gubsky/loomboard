import { configDefaults, defineConfig } from "vitest/config";
import type { PluginOption } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createProxyMiddleware } from "http-proxy-middleware";

// @loomboard/workflow lives in this repo (packages/workflow) and is consumed
// from SOURCE rather than as an installed dep, mirroring how loomcycle's web
// console consumes @loomcycle/def-fields. That keeps the edit-reload loop
// instant while the package is being built; once it is published, a consumer
// outside this repo installs it normally. Its classes are scoped
// (.loomboard-workflow / lb-wf-*), so nothing leaks into the app's styles.
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const workflowSrc = path.resolve(repoRoot, "packages/workflow/src/index.ts");
const workflowStyles = path.resolve(repoRoot, "packages/workflow/src/styles.css");

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
  resolve: {
    alias: {
      // Longest specifier first — Vite matches in order.
      "@loomboard/workflow/styles.css": workflowStyles,
      "@loomboard/workflow": workflowSrc,
    },
    // packages/workflow has its OWN node_modules (it needs react + react-dom
    // to build and test standalone). Consuming it from source therefore lets
    // Vite resolve a SECOND React: our own files resolve `react` to the root
    // copy, but @xyflow/react is a PRE-BUILT dep whose internal react import
    // resolves relative to ITS location — packages/workflow/node_modules.
    //
    // The result is react-dom rendering with the root React while
    // ReactFlowProvider calls hooks on the nested one, so the dispatcher is
    // null: "Cannot read properties of null (reading 'useState')". React
    // unmounts the whole tree, so the symptom is a completely blank page —
    // no canvas, no sidebar, and no error on screen.
    //
    // dedupe forces every importer, nested ones included, onto the root copy.
    // Same fix and same reasoning as loomcycle's web/vite.config.ts.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  // `tauri dev` loads the app from this dev server, so the port must match
  // devUrl in tauri.conf.json. Only pin it for the Tauri build to avoid forcing
  // strictPort on the ordinary `npm run dev` workflow.
  ...(mode === "tauri"
    ? { clearScreen: false, server: { port: 5173, strictPort: true } }
    : {}),
  test: {
    // Pure reducer/metrics tests run in node.
    environment: "node",
    server: {
      deps: {
        // resolve.dedupe fixes the browser, but Vitest EXTERNALISES packages
        // under node_modules and lets Node resolve them — so @xyflow/react
        // would still pull packages/workflow/node_modules/react and the
        // duplicate-React crash would reproduce only in tests, or worse, be
        // fixed in tests while broken in the browser. Inlining routes them
        // through Vite's transform pipeline, where dedupe applies.
        inline: [/@xyflow\/react/, /@loomcycle\/def-fields/],
      },
    },
    // packages/* are self-contained units with their own vitest config, deps
    // and environment (the canvas needs jsdom, which is installed there and
    // not here). Globbing them from the app runner picks up their files
    // without their setup and fails on a missing dependency. Each package
    // runs its own `npm test`; CI runs both.
    exclude: [...configDefaults.exclude, "packages/**"],
  },
}));
