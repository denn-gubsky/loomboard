import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// NODE is the default: the pure lib/ tests are the bulk of this suite and one
// of them resolves the shared fixture through `fileURLToPath(import.meta.url)`,
// which jsdom breaks by serving a http:// module URL.
//
// The render tests opt in per file with `// @vitest-environment jsdom`. That
// is one docblock in one file, against a whole suite that would otherwise pay
// for a DOM it does not use.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
