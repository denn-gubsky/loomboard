import { describe, expect, it } from "vitest";
import { inputFields } from "./inputForm";
import { fromDefinition, handlerOf, toDefinition } from "./model";
import { askAtStart, nextVariableName, variableFindings, variableNodes } from "./variables";

const INPUT_RAW = { state: "input-1", handler: { kind: "input" } };

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
    const asked = askAtStart(m, "tone", INPUT_RAW).model;
    expect(variableFindings(variableNodes(asked))).toEqual([]);
  });
});

describe("askAtStart", () => {
  it("gives a team with no form an Input entry that asks for the variable — and binds it", () => {
    const { model, front } = askAtStart(blog({ input_template: "Tone: ${var.tone}" }), "tone", INPUT_RAW);
    expect(model.entry).toBe("input-1");
    expect(front).toBe("input-1");
    const node = model.nodes.find((n) => n.id === front)!;
    expect(inputFields(node)).toEqual([{ name: "tone", type: "string", required: true, variable: "tone" }]);
    // What the runtime sees: a schema field, required, captured into the variable.
    const h = handlerOf(node);
    expect(h.capture).toEqual({ tone: "$.tone" });
    expect((h.schema as { required: string[] }).required).toEqual(["tone"]);
    expect(toDefinition(model).transitions).toContainEqual({ from: "input-1", to: "draft", on: "success" });
    expect(variableNodes(model).find((v) => v.name === "tone")!.sources).toEqual([{ kind: "start", state: "input-1", field: "tone" }]);
  });

  it("adds to the form a team already has, and does not ask twice", () => {
    const once = askAtStart(blog(), "tone", INPUT_RAW).model;
    const twice = askAtStart(once, "audience", { state: "input-2", handler: { kind: "input" } }).model;
    expect(twice.nodes.filter((n) => n.kind === "input")).toHaveLength(1);
    expect(inputFields(twice.nodes.find((n) => n.id === "input-1")!).map((f) => f.name)).toEqual(["tone", "audience"]);
    const again = askAtStart(twice, "tone", INPUT_RAW).model;
    expect(inputFields(again.nodes.find((n) => n.id === "input-1")!)).toHaveLength(2);
  });
});

describe("nextVariableName", () => {
  it("is the first free var<N>", () => {
    expect(nextVariableName([])).toBe("var1");
    const m = askAtStart(blog(), "var1", INPUT_RAW).model;
    expect(nextVariableName(variableNodes(m))).toBe("var2");
  });
});
