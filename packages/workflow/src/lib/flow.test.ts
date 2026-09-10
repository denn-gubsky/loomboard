import { describe, expect, it } from "vitest";
import { edgeClass, edgeId, toFlowEdges, toFlowNodes } from "./flow";
import { fromDefinition } from "./model";
import { validateModel } from "./validate";

const model = fromDefinition({
  entry: "code",
  states: [
    { state: "code", handler: { kind: "agent", agent: "coder", consolidator: "judge" } },
    {
      state: "review",
      handler: { kind: "parallel", agents: ["sec", "qa"], wait: "at_least:2", consolidator: "judge" },
    },
    { state: "ship", handler: { kind: "starter", source: { channel: "x" } } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "code", to: "review", on: "success" },
    { from: "review", to: "done", on: "success" },
    { from: "review", to: "code", on: "pushback:redo" },
    { from: "code", to: "ship", on: "conditional:ready" },
  ],
});

describe("edgeClass", () => {
  it("maps each label family to its own modifier", () => {
    expect(edgeClass("success")).toContain("--success");
    expect(edgeClass("pushback:redo")).toContain("--pushback");
    expect(edgeClass("conditional:x > 1")).toContain("--conditional");
  });

  it("gives every pushback reason the same class", () => {
    // One class per reason would be unbounded; the reason lives in the label.
    expect(edgeClass("pushback:redo")).toBe(edgeClass("pushback:rework"));
  });
});

describe("edgeId", () => {
  it("is stable across reordering and unique per outbound label", () => {
    const [a, , c] = model.edges;
    expect(edgeId(a)).toBe("code success review");
    expect(edgeId(c)).toBe("review pushback:redo code");
    expect(new Set(model.edges.map(edgeId)).size).toBe(model.edges.length);
  });
});

describe("toFlowNodes", () => {
  const findings = validateModel(model);
  const nodes = toFlowNodes(model, findings, "review");

  it("flags the entry state", () => {
    expect(nodes.find((n) => n.id === "code")!.data.isEntry).toBe(true);
    expect(nodes.find((n) => n.id === "review")!.data.isEntry).toBe(false);
  });

  it("carries the agents each state runs", () => {
    expect(nodes.find((n) => n.id === "code")!.data.agents).toEqual(["coder"]);
    expect(nodes.find((n) => n.id === "review")!.data.agents).toEqual(["sec", "qa"]);
    expect(nodes.find((n) => n.id === "done")!.data.agents).toEqual([]);
  });

  it("carries the parallel wait policy and consolidator", () => {
    const review = nodes.find((n) => n.id === "review")!.data;
    expect(review.wait).toBe("at_least:2");
    expect(review.consolidator).toBe("judge");
  });

  it("marks the selected node", () => {
    expect(nodes.find((n) => n.id === "review")!.selected).toBe(true);
    expect(nodes.find((n) => n.id === "code")!.selected).toBe(false);
  });

  it("routes each finding to its own node, errors before info", () => {
    // `ship` is an unknown kind → exactly one info finding, no errors.
    const ship = nodes.find((n) => n.id === "ship")!.data.findings;
    expect(ship).toHaveLength(1);
    expect(ship[0].level).toBe("info");
    expect(nodes.find((n) => n.id === "code")!.data.findings).toEqual([]);
  });
});

describe("toFlowEdges", () => {
  const edges = toFlowEdges(model, validateModel(model));

  it("hides the success label and shows named routes", () => {
    // `success` on every edge is noise — the arrow already says "and then".
    expect(edges.find((e) => e.id === "code success review")!.label).toBe("");
    expect(edges.find((e) => e.id === "review pushback:redo code")!.label).toBe("pushback:redo");
    expect(edges.find((e) => e.id === "code conditional:ready ship")!.label).toBe(
      "conditional:ready",
    );
  });

  it("tags every edge as control flow", () => {
    // Data edges (RFC CZ C1) arrive with the Starter; the discriminator is
    // already carried so that addition does not reshape this contract.
    expect(edges.every((e) => e.data.kind === "control")).toBe(true);
  });

  it("preserves source and target", () => {
    const e = edges.find((x) => x.id === "review pushback:redo code")!;
    expect([e.source, e.target]).toEqual(["review", "code"]);
  });
});
