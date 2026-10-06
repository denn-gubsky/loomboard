import { describe, expect, it } from "vitest";
import { fromJsonDraft, viewDefinition } from "./jsonDraft";
import { fromDefinition, toDefinition, type JsonObject } from "./model";

const def: JsonObject = {
  entry: "a",
  states: [
    { state: "a", handler: { kind: "agent", agent: "x" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [{ from: "a", to: "done", on: "success" }],
  layout: { nodes: { a: { x: 0, y: 0 }, done: { x: 260, y: 0 } } },
};

describe("viewDefinition", () => {
  it("is the draft with the canvas's positions written, even when nothing moved", () => {
    const { layout: _l, ...noLayout } = def;
    const shown = viewDefinition(fromDefinition(noLayout));
    expect(Object.keys((shown.layout as { nodes: object }).nodes)).toEqual(["a", "done"]);
    expect({ ...shown, layout: undefined }).toEqual({ ...noLayout, layout: undefined });
  });
});

describe("fromJsonDraft", () => {
  it("rebuilds the canvas from the text, positions from the text", () => {
    const m = fromJsonDraft(def, null);
    expect(m.nodes.map((n) => [n.id, n.position])).toEqual([
      ["a", { x: 0, y: 0 }],
      ["done", { x: 260, y: 0 }],
    ]);
    expect(m.layoutDirty).toBe(false);
    expect(toDefinition(m)).toEqual(def);
  });

  it("places a state typed without a position right of the graph, moving nothing else", () => {
    const typed = {
      ...def,
      states: [...(def.states as JsonObject[]), { state: "review", handler: { kind: "agent", agent: "r" } }],
    };
    const m = fromJsonDraft(typed, fromDefinition(def));
    expect(m.nodes.find((n) => n.id === "review")!.position).toEqual({ x: 520, y: 0 });
    expect(m.nodes.find((n) => n.id === "a")!.position).toEqual({ x: 0, y: 0 });
    expect(m.layoutDirty).toBe(true);
  });

  it("keeps where a state was on the canvas when the text drops its position", () => {
    const prev = fromDefinition({ ...def, layout: { nodes: { a: { x: 40, y: 80 }, done: { x: 300, y: 80 } } } });
    const m = fromJsonDraft({ ...def, layout: { nodes: { done: { x: 300, y: 80 } } } }, prev);
    expect(m.nodes.find((n) => n.id === "a")!.position).toEqual({ x: 40, y: 80 });
  });
});
