import { describe, expect, it } from "vitest";
import { forkOverlay } from "./fork";
import { fromDefinition, toDefinition } from "./model";
import { declareVariable, nextVariableName, setVariableDefault, undeclareVariable, variableFindings, variableNodes } from "./variables";


// The screenshot team: draft → edit → published, with a revise loop.
const blog = (edit: Record<string, unknown> = {}) =>
  fromDefinition({
    entry: "draft",
    states: [
      { state: "draft", handler: { kind: "agent", agent: "marketing/writer" } },
      { state: "edit", handler: { kind: "agent", agent: "marketing/editor", ...edit } },
      { state: "published", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "draft", to: "edit", on: "success" },
      { from: "edit", to: "draft", on: "pushback:revise" },
      { from: "edit", to: "published", on: "success" },
    ],
  });

const byName = (m: ReturnType<typeof blog>) => new Map(variableNodes(m).map((v) => [v.name, v]));

describe("variableNodes", () => {
  it("draws a variable a prompt reads, with who reads it — and no source when nothing sets it", () => {
    const v = byName(blog({ input_template: "Tone: ${var.tone}. Audience: ${var.audience:-everyone}." }));
    expect(v.get("tone")).toMatchObject({ id: "var:tone", sources: [], readers: [{ state: "edit", field: "input_template" }] });
    expect(v.get("audience")!.readers).toHaveLength(1);
  });

  it("names each source: asked at Start, captured from a state, set by a vars step", () => {
    const m = fromDefinition({
      entry: "form",
      states: [
        {
          state: "form",
          handler: { kind: "input", schema: { type: "object", properties: { tone: { type: "string" } } }, capture: { tone: "$.tone", whole: "$" } },
        },
        {
          state: "research",
          handler: { kind: "starter", source: { channel: "in" }, fanout: { agent: "r", max: 1 }, binds: { part: "$.part" }, capture: { notes: "$.results[0].output" } },
        },
        { state: "limits", handler: { kind: "vars", set: { max_words: "100" } } },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [
        { from: "form", to: "research", on: "success" },
        { from: "research", to: "limits", on: "success" },
        { from: "limits", to: "done", on: "success" },
      ],
    });
    const v = new Map(variableNodes(m).map((x) => [x.name, x.sources]));
    expect(v.get("tone")).toEqual([{ kind: "start", state: "form", field: "tone" }]);
    // A capture on the form that is not a field read is the author's own.
    expect(v.get("whole")).toEqual([{ kind: "capture", state: "form", path: "$" }]);
    expect(v.get("part")).toEqual([{ kind: "capture", state: "research", path: "$.part" }]);
    expect(v.get("notes")).toEqual([{ kind: "capture", state: "research", path: "$.results[0].output" }]);
    expect(v.get("max_words")).toEqual([{ kind: "set", state: "limits" }]);
  });

  it("reads an input Starter's form from its `binds`, and its results from `capture`", () => {
    const m = fromDefinition({
      entry: "research",
      states: [
        {
          state: "research",
          handler: {
            kind: "starter",
            source: { kind: "input", channel: "" },
            schema: { type: "object", properties: { chunk_id: { type: "string" } } },
            fanout: { agent: "r", max: 1 },
            binds: { chunk_id: "$.chunk_id" },
            capture: { research: "$.results[0].output" },
          },
        },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "research", to: "done", on: "success" }],
    });
    const v = new Map(variableNodes(m).map((x) => [x.name, x.sources]));
    expect(v.get("chunk_id")).toEqual([{ kind: "start", state: "research", field: "chunk_id" }]);
    expect(v.get("research")).toEqual([{ kind: "capture", state: "research", path: "$.results[0].output" }]);
  });

  it("keeps a position the operator dragged it to", () => {
    const m = { ...blog({ input_template: "${var.tone}" }), derivedPositions: { "var:tone": { x: 7, y: 9 } } };
    expect(variableNodes(m)[0]).toMatchObject({ position: { x: 7, y: 9 }, placed: true });
  });
});

describe("variableFindings", () => {
  it("flags a variable nothing sets — it expands to empty — and nothing else", () => {
    const m = blog({ input_template: "Tone: ${var.tone}" });
    const [f] = variableFindings(variableNodes(m));
    expect(f).toMatchObject({ level: "info", nodeId: "edit" });
    expect(f.message).toContain("${var.tone}");
    const declared = declareVariable(m, "tone");
    expect(variableFindings(variableNodes(declared))).toEqual([]);
  });
});

describe("declared variables (the team's `vars`, RFC DV)", () => {
  it("draws a declared variable with its default — a source, no graph edge, and no start-form field", () => {
    const m = declareVariable(blog({ input_template: "Tone: ${var.tone}" }), "tone", "formal");
    const tone = variableNodes(m).find((v) => v.name === "tone")!;
    expect(tone.sources).toEqual([{ kind: "declared", value: "formal" }]);
    expect(tone.readers).toEqual([{ state: "edit", field: "input_template" }]);
    // The graph is untouched: no Input entry is added for it any more.
    expect(m.entry).toBe("draft");
    expect(toDefinition(m).vars).toEqual({ tone: "formal" });
  });

  it("declares once, edits the default, and removes it", () => {
    const m = declareVariable(blog(), "tone", "formal");
    expect(declareVariable(m, "tone", "warm")).toBe(m);
    expect(toDefinition(setVariableDefault(m, "tone", "warm")).vars).toEqual({ tone: "warm" });
    expect(toDefinition(undeclareVariable(m, "tone")).vars).toBeUndefined();
  });

  it("the save sends vars: {} when the last declared variable is removed — a fork that omits `vars` keeps the parent's", () => {
    const savedDef = { ...toDefinition(blog()), vars: { tone: "formal" } };
    const cleared = undeclareVariable(fromDefinition(savedDef), "tone");
    expect("vars" in toDefinition(cleared)).toBe(false);
    expect(forkOverlay(savedDef, toDefinition(cleared)).vars).toEqual({});
    // An untouched definition with no `vars` gains none.
    expect("vars" in toDefinition(blog())).toBe(false);
  });
});

describe("nextVariableName", () => {
  it("is the first free var<N>", () => {
    expect(nextVariableName([])).toBe("var1");
    const m = declareVariable(blog(), "var1");
    expect(nextVariableName(variableNodes(m))).toBe("var2");
  });
});
