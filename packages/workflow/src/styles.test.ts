import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The stylesheet's few rules that are about geometry, not taste.

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** A @keyframes block's body, or "" when absent. */
function keyframes(name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return "";
}

describe("Run mode's active node", () => {
  it("glows inward — an outer glow covers the ~30px violet hop to the node beside it", () => {
    // Regression: an outer 22px blur + 7px spread painted over the Starter →
    // agent and channel hops (nodes sit above the edge layer), leaving only
    // their arrowheads. Outside the box only a crisp ring of ≤3px is allowed.
    const body = keyframes("lb-wf-run-flash");
    expect(body, "the flash keyframes exist").not.toBe("");
    const shadows = [...body.matchAll(/box-shadow:([^;]+);/g)].flatMap((m) => m[1].split(/,(?![^(]*\))/));
    expect(shadows.length).toBeGreaterThan(0);
    for (const s of shadows.map((x) => x.trim()).filter((x) => !x.startsWith("inset"))) {
      const [, , blur = "0", spread = "0"] = s.match(/-?\d+(?:\.\d+)?(?:px)?/g) ?? [];
      expect(parseFloat(blur), `outer shadow "${s}" must not blur`).toBe(0);
      expect(parseFloat(spread), `outer shadow "${s}" spreads too far`).toBeLessThanOrEqual(3);
    }
  });
});
