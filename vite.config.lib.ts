import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Library build for the published @loomboard/chat package (the app is built by
// the default vite.config.ts). Emits ESM + CJS to dist/; declarations come from
// `tsc -p tsconfig.lib.json` and styles.css is copied in — see the build:lib
// script. Everything imported by bare specifier (react, @loomcycle/client, the
// markdown/katex/pdf stack, and the katex/hljs CSS) is externalized so it isn't
// duplicated into the consumer's bundle; only our own relative source is bundled.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/chat/index.ts", import.meta.url)),
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
    },
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      external: (id) => !id.startsWith(".") && !id.startsWith("/"),
    },
  },
});
