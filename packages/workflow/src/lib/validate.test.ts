import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fromDefinition } from "./model";
import { canSave, validateModel, validateOn, validateWait } from "./validate";

// The TypeScript half of the shared validation fixture set.
//
// The fixture SHIPS IN THE PUBLISHED PACKAGE (package.json `files` includes
// testdata/), so when this component is integrated into loomcycle its Go twin
// reads the very same file out of node_modules/@loomboard/workflow/testdata/
// and asserts the authoritative validator agrees. One file, two validators, no
// copy to drift — which is the whole point, and the reason the fixture lives
// here rather than being duplicated on each side of the repo boundary.
//
// Until that integration lands, this half stands alone and the go_valid column
// is a claim about loomcycle that nothing yet checks. See the fixture header.

interface SharedCase {
  name: string;
  go_valid: boolean;
  ts_valid: boolean;
  why_divergent?: string;
  definition: unknown;
}

const CASES_PATH = fileURLToPath(
  new URL("../../testdata/validate-cases.json", import.meta.url),
);

const cases: SharedCase[] = JSON.parse(readFileSync(CASES_PATH, "utf8")).cases;

describe("validateModel — shared fixtures", () => {
  it("finds the fixture file the Go validator will also drive", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const tc of cases) {
    it(`${tc.name} → ${tc.ts_valid ? "saveable" : "blocked"}`, () => {
      const findings = validateModel(fromDefinition(tc.definition));
      expect(canSave(findings), JSON.stringify(findings, null, 2)).toBe(tc.ts_valid);
    });
  }

  // The mirror is allowed to disagree with the runtime in exactly one place.
  // Anywhere else, a divergence means one of the two is wrong.
  it("diverges from the Go validator only where the fixture argues for it", () => {
    for (const tc of cases) {
      if (tc.go_valid !== tc.ts_valid) {
        expect(tc.why_divergent, `case ${tc.name} diverges without justification`).toBeTruthy();
      }
    }
  });
});

describe("unknown handler kinds", () => {
  const withUnknown = {
    entry: "on-pr",
    states: [
      { state: "on-pr", handler: { kind: "from-a-newer-runtime", source: { channel: "x" } } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "on-pr", to: "done", on: "success" }],
  };

  it("reports an unknown kind at info, never as an error", () => {
    const findings = validateModel(fromDefinition(withUnknown));
    expect(canSave(findings)).toBe(true);
    const info = findings.filter((f) => f.level === "info");
    expect(info).toHaveLength(1);
    expect(info[0].nodeId).toBe("on-pr");
    expect(info[0].message).toContain("from-a-newer-runtime");
  });

  it("does not apply handler-shape rules it cannot know", () => {
    // This kind sets neither `agent` nor `agents`; under the `agent` rules
    // that would be an error. It must not be.
    const findings = validateModel(fromDefinition(withUnknown));
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
  });

  it("does not call an unknown kind a dead end", () => {
    // We cannot tell whether a future kind is terminal-like, so saying nothing
    // beats a false positive on a graph the runtime accepts.
    const model = fromDefinition({
      entry: "on-pr",
      states: [{ state: "on-pr", handler: { kind: "from-a-newer-runtime" } }],
      transitions: [],
    });
    expect(validateModel(model).filter((f) => f.level === "error")).toEqual([]);
  });
});

describe("validateOn", () => {
  it("accepts the three well-formed label shapes", () => {
    expect(validateOn("success")).toBeNull();
    expect(validateOn("pushback:redo")).toBeNull();
    expect(validateOn("conditional:x > 1")).toBeNull();
  });

  it("rejects an unknown label and an empty reason or expression", () => {
    expect(validateOn("maybe")).toBeTruthy();
    expect(validateOn("pushback:")).toBeTruthy();
    expect(validateOn("pushback:   ")).toBeTruthy();
    expect(validateOn("conditional:")).toBeTruthy();
  });
});

describe("validateWait", () => {
  it("accepts the substrate's vocabulary", () => {
    for (const w of ["", "all", "any", "at_least:1", "at_least:12"]) {
      expect(validateWait(w)).toBeNull();
    }
  });

  it("rejects a non-positive or non-integer at_least", () => {
    for (const w of ["at_least:0", "at_least:-1", "at_least:x", "at_least:1.5", "sometimes"]) {
      expect(validateWait(w)).toBeTruthy();
    }
  });
});

describe("validateModel — findings carry an anchor", () => {
  it("attaches a node id so the canvas can highlight the state", () => {
    const findings = validateModel(
      fromDefinition({
        entry: "start",
        states: [
          { state: "start", handler: { kind: "agent", agent: "a" } },
          { state: "orphan", handler: { kind: "terminal" } },
          { state: "done", handler: { kind: "terminal" } },
        ],
        transitions: [{ from: "start", to: "done", on: "success" }],
      }),
    );
    const unreachable = findings.find((f) => f.message.includes("unreachable"));
    expect(unreachable?.nodeId).toBe("orphan");
  });

  it("attaches a transition index so the canvas can highlight the edge", () => {
    const findings = validateModel(
      fromDefinition({
        entry: "start",
        states: [
          { state: "start", handler: { kind: "agent", agent: "a" } },
          { state: "done", handler: { kind: "terminal" } },
        ],
        transitions: [{ from: "start", to: "done", on: "maybe" }],
      }),
    );
    expect(findings.find((f) => f.message.includes("invalid `on`"))?.edgeIndex).toBe(0);
  });
});
