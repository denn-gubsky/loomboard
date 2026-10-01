import { describe, expect, it } from "vitest";
import { COLUMN_WIDTH, autoLayout, needsAutoLayout, withLayout } from "./layout";
import { fromDefinition } from "./model";

const linear = fromDefinition({
  entry: "a",
  states: [
    { state: "a", handler: { kind: "agent", agent: "x" } },
    { state: "b", handler: { kind: "agent", agent: "y" } },
    { state: "c", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "a", to: "b", on: "success" },
    { from: "b", to: "c", on: "success" },
  ],
});

describe("autoLayout", () => {
  it("lays a linear graph out left to right, one node per column", () => {
    const pos = autoLayout(linear);
    expect(pos.a.x).toBe(0);
    expect(pos.b.x).toBe(COLUMN_WIDTH);
    expect(pos.c.x).toBe(COLUMN_WIDTH * 2);
    // A single node per column sits on the spine.
    expect([pos.a.y, pos.b.y, pos.c.y]).toEqual([0, 0, 0]);
  });

  it("spreads a fan-out across one column, centred on the spine", () => {
    const pos = autoLayout(
      fromDefinition({
        entry: "a",
        states: [
          { state: "a", handler: { kind: "agent", agent: "x" } },
          { state: "b1", handler: { kind: "terminal" } },
          { state: "b2", handler: { kind: "terminal" } },
        ],
        transitions: [
          { from: "a", to: "b1", on: "success" },
          { from: "a", to: "b2", on: "pushback:redo" },
        ],
      }),
    );
    expect(pos.b1.x).toBe(COLUMN_WIDTH);
    expect(pos.b2.x).toBe(COLUMN_WIDTH);
    // Centred: the two siblings straddle y=0 rather than hanging below it.
    expect(pos.b1.y).toBe(-pos.b2.y);
    expect(pos.b1.y).toBeLessThan(0);
  });

  // A pushback edge is normal in a team graph, not an edge case. Ranking by
  // longest path would drag its target rightward every time.
  it("does not push a pushback target rightward", () => {
    const pos = autoLayout(
      fromDefinition({
        entry: "code",
        states: [
          { state: "code", handler: { kind: "agent", agent: "c" } },
          { state: "review", handler: { kind: "consolidator", agent: "j" } },
          { state: "done", handler: { kind: "terminal" } },
        ],
        transitions: [
          { from: "code", to: "review", on: "success" },
          { from: "review", to: "done", on: "success" },
          { from: "review", to: "code", on: "pushback:redo" },
        ],
      }),
    );
    expect(pos.code.x).toBe(0);
    expect(pos.review.x).toBe(COLUMN_WIDTH);
    expect(pos.done.x).toBe(COLUMN_WIDTH * 2);
  });

  it("parks a state unreachable from entry in a trailing column", () => {
    const pos = autoLayout(
      fromDefinition({
        entry: "a",
        states: [
          { state: "a", handler: { kind: "agent", agent: "x" } },
          { state: "b", handler: { kind: "terminal" } },
          { state: "orphan", handler: { kind: "terminal" } },
        ],
        transitions: [{ from: "a", to: "b", on: "success" }],
      }),
    );
    // Drawn, not stacked at the origin — the operator has to see it to fix it.
    expect(pos.orphan.x).toBeGreaterThan(pos.b.x);
  });

  // The pcparts test team, as it runs on TrueNAS: two Starters joined by a
  // hand-off channel. The layout the operator asked for is one row in the
  // order things happen.
  const pipeline = fromDefinition({
    entry: "research",
    states: [
      {
        state: "research",
        handler: {
          kind: "starter",
          source: { channel: "in" },
          fanout: { agent: "marketing/researcher", per: "message", max: 1 },
          sink: { channel: "handoff" },
        },
      },
      {
        state: "edit",
        handler: {
          kind: "starter",
          source: { channel: "handoff" },
          fanout: { agent: "marketing/article-editor", per: "message", max: 1 },
          sink: { channel: "out" },
        },
      },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "research", to: "edit", on: "success" },
      { from: "edit", to: "done", on: "success" },
    ],
  });

  it("lays a Starter pipeline out as ONE row: channel, Starter, agent, channel, … then End", () => {
    const pos = autoLayout(pipeline);
    const row = ["channel:in", "research", "agent:research", "channel:handoff", "edit", "agent:edit", "channel:out", "done"];
    expect(row.map((id) => pos[id]?.x)).toEqual(row.map((_, i) => i * COLUMN_WIDTH));
    expect(row.map((id) => pos[id]?.y)).toEqual(row.map(() => 0));
  });

  it("places a Starter after the channel that feeds it, not after the transition into it", () => {
    // research → edit is one hop of control flow, but edit reads what
    // research's agent publishes: data is the longer path, and it wins.
    const pos = autoLayout(pipeline);
    expect(pos.edit.x).toBeGreaterThan(pos["channel:handoff"].x);
  });

  it("lays out a Starter that republishes to the channel it reads — a data loop — without dragging it", () => {
    const pos = autoLayout(
      fromDefinition({
        entry: "s",
        states: [
          { state: "s", handler: { kind: "starter", source: { channel: "q" }, fanout: { agent: "w" }, sink: { channel: "q" } } },
          { state: "done", handler: { kind: "terminal" } },
        ],
        transitions: [{ from: "s", to: "done", on: "success" }],
      }),
    );
    // The loop's channel stays BEFORE the Starter it feeds.
    expect([pos["channel:q"].x, pos.s.x, pos["agent:s"].x]).toEqual([0, COLUMN_WIDTH, COLUMN_WIDTH * 2]);
  });

  it("is deterministic — the same graph lays out identically every time", () => {
    expect(autoLayout(linear)).toEqual(autoLayout(linear));
  });

  it("survives a graph with no entry and a graph with no nodes", () => {
    expect(autoLayout(fromDefinition({ states: [], transitions: [] }))).toEqual({});
    const noEntry = autoLayout(
      fromDefinition({
        states: [{ state: "only", handler: { kind: "terminal" } }],
        transitions: [],
      }),
    );
    expect(noEntry.only).toEqual({ x: 0, y: 0 });
  });
});

describe("needsAutoLayout", () => {
  it("is true when the definition carries no layout", () => {
    expect(needsAutoLayout(linear)).toBe(true);
  });

  it("is true for an empty or malformed layout block", () => {
    for (const layout of [{}, { nodes: {} }, { nodes: null }, "nope", null]) {
      expect(needsAutoLayout(fromDefinition({ states: [], transitions: [], layout }))).toBe(true);
    }
  });

  it("is false once positions are stored", () => {
    const m = fromDefinition({
      states: [{ state: "a", handler: { kind: "terminal" } }],
      transitions: [],
      layout: { nodes: { a: { x: 1, y: 2 } } },
    });
    expect(needsAutoLayout(m)).toBe(false);
  });
});

describe("withLayout", () => {
  const m = fromDefinition({
    entry: "s",
    states: [
      { state: "s", handler: { kind: "starter", source: { channel: "in" }, fanout: { agent: "w" } } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "s", to: "done", on: "success" }],
  });

  it("moves the states AND the derived nodes, without dirtying a layout applied on open", () => {
    const next = withLayout(m, autoLayout(m), false);
    expect(next.nodes.find((n) => n.id === "s")!.position).toEqual({ x: COLUMN_WIDTH, y: 0 });
    expect(next.derivedPositions).toEqual({ "channel:in": { x: 0, y: 0 }, "agent:s": { x: COLUMN_WIDTH * 2, y: 0 } });
    expect(next.layoutDirty).toBe(false);
    expect(withLayout(m, autoLayout(m), true).layoutDirty).toBe(true);
  });
});
