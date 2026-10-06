import { describe, expect, it } from "vitest";
import { bindingNodes, promptText } from "./bindings";
import {
  applyDataWire,
  bindingRefError,
  dataConnection,
  losesHandoff,
  placeBinding,
  planDataWire,
  removeBinding,
} from "./dataWiring";
import { BINDING_HANDLE, HANDLE, VARIABLE_HANDLE } from "./flow";
import { fromDefinition, toDefinition, type CanvasModel } from "./model";
import { declareVariable, variableNodes } from "./variables";

const blog = (edit: Record<string, unknown> = {}) =>
  fromDefinition({
    entry: "draft",
    states: [
      { state: "draft", handler: { kind: "agent", agent: "w" } },
      { state: "edit", handler: { kind: "agent", agent: "e", ...edit } },
      { state: "intake", handler: { kind: "starter", source: { channel: "in" }, fanout: { agent: "a", max: 1 }, prompt: { system: "S", input: "Item: {{starter.message}}" } } },
      { state: "published", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "draft", to: "edit", on: "success" },
      { from: "edit", to: "published", on: "success" },
    ],
  });

const withTone = (m: CanvasModel) => declareVariable(m, "tone", "formal");
const views = (m: CanvasModel) => [variableNodes(m), bindingNodes(m)] as const;
const node = (m: CanvasModel, id: string) => m.nodes.find((n) => n.id === id)!;
const varDrag = (target: string) => ({ source: "var:tone", target, sourceHandle: VARIABLE_HANDLE.out, targetHandle: HANDLE.targetBind });

describe("planDataWire / applyDataWire", () => {
  it("a variable dragged onto an agent state goes into its user input — and is then drawn as read by it", () => {
    const m = withTone(blog({ input_template: "Edit the draft." }));
    const w = planDataWire(m, varDrag("edit"), ...views(m));
    expect(w).toEqual({ state: "edit", field: "input_template", token: "${var.tone}" });
    const next = applyDataWire(m, w!);
    expect(promptText(node(next, "edit"), "input_template")).toBe("Edit the draft.\n${var.tone}");
    expect(variableNodes(next).find((v) => v.name === "tone")!.readers).toEqual([{ state: "edit", field: "input_template" }]);
  });

  it("goes into a Starter's prompt.input, keeping the rest of its prompt", () => {
    const m = withTone(blog());
    const next = applyDataWire(m, planDataWire(m, varDrag("intake"), ...views(m))!);
    const prompt = (toDefinition(next).states as { state: string; handler: { prompt?: unknown } }[]).find((s) => s.state === "intake")!.handler.prompt;
    expect(prompt).toEqual({ system: "S", input: "Item: {{starter.message}}\n${var.tone}" });
  });

  it("wires a placed Document and a Memory the same way, as their placeholders", () => {
    let m = placeBinding(blog(), [], "document", "/guides/style#Tone").model;
    m = placeBinding(m, bindingNodes(m), "memory", "core_blocks").model;
    for (const [id, token] of [
      ["binding:document:/guides/style#Tone", "{{document:/guides/style#Tone}}"],
      ["binding:memory:core_blocks", "{{memory:core_blocks}}"],
    ]) {
      const w = planDataWire(m, { source: id, target: "edit", sourceHandle: BINDING_HANDLE.out, targetHandle: HANDLE.targetBind }, ...views(m));
      expect(w?.token).toBe(token);
      m = applyDataWire(m, w!);
    }
    expect(promptText(node(m, "edit"), "input_template")).toBe("{{document:/guides/style#Tone}}\n{{memory:core_blocks}}");
    expect(bindingNodes(m).map((b) => b.readers.map((r) => r.state))).toEqual([["edit"], ["edit"]]);
  });

  it("does not write a token the state already names", () => {
    const m = withTone(blog({ input_template: "Tone: ${var.tone}" }));
    expect(applyDataWire(m, planDataWire(m, varDrag("edit"), ...views(m))!)).toEqual(m);
  });

  it("refuses a state with no prompt, the wrong handle, and a drag that starts on a state", () => {
    const m = withTone(blog());
    expect(planDataWire(m, varDrag("published"), ...views(m))).toBeNull();
    expect(planDataWire(m, { ...varDrag("edit"), targetHandle: HANDLE.targetLeft }, ...views(m))).toBeNull();
    expect(dataConnection(m, varDrag("published"), ...views(m))).toBe("invalid");
    // The binding handle takes data nodes only: a state dragged onto it is no transition.
    expect(dataConnection(m, { source: "draft", target: "edit", sourceHandle: HANDLE.sourceRight, targetHandle: HANDLE.targetBind }, ...views(m))).toBe("invalid");
    // An ordinary transition is none of this module's business.
    expect(dataConnection(m, { source: "draft", target: "edit", sourceHandle: HANDLE.sourceRight, targetHandle: HANDLE.targetLeft }, ...views(m))).toBeNull();
  });
});

describe("losesHandoff", () => {
  it("warns when the first token gives an agent state a template — it stops receiving the previous output (G17)", () => {
    const m = withTone(blog());
    expect(losesHandoff(m, planDataWire(m, varDrag("edit"), ...views(m))!)).toBe(true);
  });

  it("does not warn for a state that already had a template, an entry nothing hands over to, or a Starter", () => {
    const templated = withTone(blog({ input_template: "Edit." }));
    expect(losesHandoff(templated, planDataWire(templated, varDrag("edit"), ...views(templated))!)).toBe(false);
    const m = withTone(blog());
    expect(losesHandoff(m, planDataWire(m, varDrag("intake"), ...views(m))!)).toBe(false);
    const plain = blog();
    expect(losesHandoff(plain, { state: "draft", field: "input_template", token: "${var.x}" })).toBe(false);
  });
});

describe("placeBinding / removeBinding", () => {
  it("places a node as layout only — no content — and draws it unwired", () => {
    const m = blog();
    const { model, id } = placeBinding(m, [], "document", " /guides/style ");
    expect(id).toBe("binding:document:/guides/style");
    expect(bindingNodes(model)).toMatchObject([{ id, kind: "document", ref: "/guides/style", readers: [] }]);
    const { layout: _a, ...before } = toDefinition(m);
    const { layout: _b, ...after } = toDefinition(model);
    expect(after).toEqual(before);
  });

  it("refuses a name the runtime would not expand, and says why", () => {
    expect(bindingRefError("document", "{{x}}")).toMatch(/path or id/);
    expect(bindingRefError("memory", "Core Blocks")).toMatch(/section/);
    expect(bindingRefError("memory", "key:user/profile")).toBeUndefined();
    expect(bindingRefError("document", "")).toMatch(/required/);
    expect(placeBinding(blog(), [], "document", "{{x}}").model).toEqual(blog());
  });

  it("removes an unwired node, and never one a prompt names", () => {
    const placed = placeBinding(blog(), [], "memory", "core_blocks").model;
    const gone = removeBinding(placed, bindingNodes(placed)[0]);
    expect(bindingNodes(gone)).toEqual([]);
    const wired = blog({ input_template: "{{memory:core_blocks}}" });
    expect(removeBinding(wired, bindingNodes(wired)[0])).toBe(wired);
  });
});
