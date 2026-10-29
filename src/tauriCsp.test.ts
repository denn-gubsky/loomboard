import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The desktop webview's CSP (src-tauri/tauri.conf.json). Mermaid's sandbox
// mode draws each diagram inside a data: iframe (DiagramBlock), which a strict
// default-src would refuse. Remote images stay blocked: an image URL in agent
// output is fetched without a click, so a prompt-injected answer could carry
// data out in its query string. Scripts stay first-party only.
const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const policies: Record<string, Record<string, string>> = {
  csp: conf.app.security.csp,
  devCsp: conf.app.security.devCsp,
};

describe("the desktop CSP", () => {
  for (const [name, p] of Object.entries(policies)) {
    it(`${name} lets a Mermaid diagram's data: iframe load`, () => {
      expect(p["frame-src"]?.split(/\s+/)).toContain("data:");
    });
    it(`${name} loads no remote image, which could carry data out`, () => {
      expect(p["img-src"]).not.toMatch(/https?:|\*/);
    });
    it(`${name} still runs no script from anywhere but the app`, () => {
      expect(p["script-src"]).not.toMatch(/https?:|data:|'unsafe-eval'/);
      expect(p["object-src"]).toBe("'none'");
    });
  }
});
