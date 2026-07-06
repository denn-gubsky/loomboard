import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./extension/manifest.config";

// Chrome MV3 extension build. @crxjs handles the multi-entry layout (side-panel
// HTML app + module service worker + content script) and generates the manifest.
// No dev-proxy plugin here — the side panel fetches loomcycle directly
// (host_permissions bypass page CORS); see src/lib/proxyMode.ts (isExtension).
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: { outDir: "extension/dist", emptyOutDir: true },
});
