import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A structural guard over the app shell's layout contract.
//
// WHY this exists: `.app-shell` is `display: flex` — a ROW. A surface mounted
// into it that does not declare `flex: 1` shrinks to its content width, and an
// embedded component sized `width: 100%` of that resolves to zero. The result
// is a blank screen with no error anywhere: the modules load, the component
// mounts, the tests pass, and nothing is visible.
//
// That is exactly what shipped with the Canvas surface in #53 — `.canvas-area`
// was rendered with a class that had no CSS at all. Unit tests cannot see
// layout, so the guard has to be structural: find every surface root class the
// app actually renders, and assert the stylesheet gives it the pane rules.
//
// It is deliberately derived from the SOURCE rather than a hand-kept list, so
// the next surface someone adds is covered without anyone remembering to.

const SRC = new URL("./", import.meta.url).pathname;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/** Every `*-pane` / `*-area` class rendered as a JSX root-ish element. These
 *  are the app shell's direct children — the ones that must not collapse. */
function surfaceClasses(): string[] {
  const found = new Set<string>();
  for (const file of tsxFiles(SRC)) {
    const body = readFileSync(file, "utf8");
    for (const m of body.matchAll(/className="([a-z-]+(?:-pane|-area))"/g)) {
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

// Comments are stripped BEFORE parsing: a `/* … */` immediately above a rule
// otherwise lands inside the selector capture, so `.library-pane` reads as
// "/* … */\n.library-pane" and every lookup misses. The first version of this
// test failed on four real, correctly-styled panes for exactly that reason.
const css = readFileSync(join(SRC, "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The selectors of every rule whose body declares `flex: 1`. A pane may be
 *  styled in a grouped rule (`.a, .b, .c { … }`), so this collects selector
 *  lists rather than looking for one exact block. */
function selectorsDeclaring(prop: string, value: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, selectors, body] = m;
    const re = new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*${value}\\s*(;|$)`, "m");
    if (!re.test(body)) continue;
    for (const sel of selectors.split(",")) out.add(sel.trim());
  }
  return out;
}

describe("app shell pane layout", () => {
  const surfaces = surfaceClasses();
  const flexOne = selectorsDeclaring("flex", "1");
  const minWidthZero = selectorsDeclaring("min-width", "0");

  it("finds the surfaces the app renders", () => {
    // A sanity check on the derivation itself: if the regex stops matching,
    // every assertion below would vacuously pass.
    expect(surfaces.length).toBeGreaterThanOrEqual(5);
    expect(surfaces).toContain("canvas-area");
  });

  it.each(surfaceClasses())("%s declares flex: 1 so it cannot collapse", (cls) => {
    expect(flexOne, `.${cls} needs flex: 1 — .app-shell is a flex row`).toContain(`.${cls}`);
  });

  it.each(surfaceClasses())("%s declares min-width: 0 so its content can shrink", (cls) => {
    // Without this a wide child (a graph, a long table) forces the pane past
    // the viewport instead of scrolling inside it.
    expect(minWidthZero, `.${cls} needs min-width: 0`).toContain(`.${cls}`);
  });
});

describe("embedded component sizing", () => {
  // A surface that hosts a third-party component (the canvas, the library,
  // the memory view) also has to give that component a height, or it lays out
  // against `height: 100%` of an auto-height column and collapses vertically.
  const EMBEDS: [surface: string, component: string][] = [
    ["canvas-area", "loomboard-workflow"],
    ["library-pane", "loomcycle-library"],
    ["memory-pane", "loomcycle-memory-view"],
    ["boards-pane", "loomcycle-loomboard"],
  ];

  const flexOne = selectorsDeclaring("flex", "1");
  const minHeightZero = selectorsDeclaring("min-height", "0");

  it.each(EMBEDS)("%s > .%s is given a box to fill", (surface, component) => {
    const sel = `.${surface} > .${component}`;
    expect(flexOne, `${sel} needs flex: 1`).toContain(sel);
    expect(minHeightZero, `${sel} needs min-height: 0`).toContain(sel);
  });
});
