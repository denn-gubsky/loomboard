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

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const m = css.match(new RegExp(`(?:^|})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*{([^}]*)}`));
  return m ? m[1] : "";
}

describe("The panels under the graph", () => {
  it("share one bounded, scrolling area, so together they cannot squeeze the graph out", () => {
    // Regression: the output (280px), the runtime check and the findings
    // (120px) each had their own cap and stacked, leaving a laptop-height
    // canvas a strip of graph.
    const below = rule(".loomboard-workflow .lb-wf-below");
    expect(below).toMatch(/max-height:\s*40%/);
    expect(below).toMatch(/overflow-y:\s*auto/);
    expect(below).toMatch(/min-height:\s*0/);
    const inner = rule(".loomboard-workflow .lb-wf-below .lb-wf-output,\n.loomboard-workflow .lb-wf-below .lb-wf-findings");
    expect(inner).toMatch(/max-height:\s*none/);
  });
});

describe("A form editor in the Inspector", () => {
  it("cannot be pushed wider than the Inspector by its own controls", () => {
    // Regression: a fieldset's default min-width is its content's, so the
    // decision questions editor ran past the Inspector's right edge and its
    // inputs were cut off.
    const boxes = rule(".loomboard-workflow .lb-wf-form-editor,\n.loomboard-workflow .lb-wf-form-editor__field");
    expect(boxes).toMatch(/min-width:\s*0/);
    expect(boxes).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.lb-wf-form-editor__field label > textarea \{[^}]*width:\s*100%[^}]*box-sizing:\s*border-box/);
  });
});

