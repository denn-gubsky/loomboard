import { describe, expect, it } from "vitest";
import { AGENT_DROP, agentNodeId, agentNodes, agentOwner } from "./agentNodes";
import { fromDefinition, toDefinition } from "./model";

const team = (layout?: unknown) =>
  fromDefinition({
    entry: "s",
    states: [
      { state: "s", handler: { kind: "starter", source: { channel: "in" }, fanout: { agent: "w", per: "message", max: 2 } } },
      { state: "a", handler: { kind: "agent", agent: "x" } },
      { state: "o", handler: { kind: "future-kind", whatever: 1 } },
    ],
    transitions: [{ from: "s", to: "a", on: "success" }],
    ...(layout ? { layout } : {}),
  });

describe("agentNodes", () => {
  it("gives every Starter — and only a Starter — a node for the agent it dispatches", () => {
    const views = agentNodes(team());
    expect(views.map((v) => [v.id, v.state, v.agents])).toEqual([["agent:s", "s", ["w"]]]);
  });

  it("drops an unplaced agent node below its Starter, and keeps a stored position", () => {
    const m = team({ nodes: { s: { x: 10, y: 20 } } });
    expect(agentNodes(m)[0]).toMatchObject({ position: { x: 10, y: 20 + AGENT_DROP }, placed: false });
    const placed = team({ nodes: { s: { x: 10, y: 20 }, "agent:s": { x: 300, y: 20 } } });
    expect(agentNodes(placed)[0]).toMatchObject({ position: { x: 300, y: 20 }, placed: true });
  });

  it("steps aside from a state literally named agent:<state>", () => {
    const m = fromDefinition({
      entry: "s",
      states: [
        { state: "s", handler: { kind: "starter", fanout: { agent: "w" } } },
        { state: "agent:s", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "s", to: "agent:s", on: "success" }],
    });
    expect(agentNodeId(m, "s")).toBe("agent:s'");
  });

  it("maps an agent node back to its Starter, and nothing else to one", () => {
    const views = agentNodes(team());
    expect(agentOwner(views, "agent:s")).toBe("s");
    expect(agentOwner(views, "s")).toBeUndefined();
  });

  it("keeps a dragged agent position in layout.nodes across a save", () => {
    const m = { ...team({ nodes: { s: { x: 0, y: 0 } } }), layoutDirty: true, derivedPositions: { "agent:s": { x: 280.4, y: 0 } } };
    const nodes = (toDefinition(m).layout as { nodes: Record<string, unknown> }).nodes;
    expect(nodes["agent:s"]).toEqual({ x: 280, y: 0 });
  });
});
