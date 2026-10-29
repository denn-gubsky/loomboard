import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The sign-in callback lands on this page with ?code=…&state=… in its URL.
// The app clears it with history.replaceState as soon as it runs, but every
// request the page makes before then (icons, the bundle, the theme script's
// stylesheet) would carry that URL in a Referer header — to wherever it is
// served from, which need not be loomcycle. no-referrer must be in force
// before the first of them.
describe("index.html", () => {
  it("sets no-referrer before any subresource is requested", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const meta = html.search(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/);
    const firstSubresource = html.search(/<(link|script|img|style)\b/);
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(firstSubresource);
  });
});
