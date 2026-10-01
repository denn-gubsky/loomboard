import { describe, expect, it } from "vitest";
import { channelNodes } from "./channelNodes";
import { withGrant } from "./channels";
import { applyWire, connectionKind, placeChannel, planWire, removeChannel } from "./channelWiring";
import { agentNodes } from "./agentNodes";
import { AGENT_HANDLE, HANDLE } from "./flow";
import { fromDefinition, handlerOf, toDefinition, type CanvasModel } from "./model";

const base = () =>
  fromDefinition({
    entry: "intake",
    states: [
      {
        state: "intake",
        handler: {
          kind: "starter",
          source: { channel: "inbox", wait: "at_least", n: 3 },
          fanout: { agent: "a", max: 4 },
        },
      },
      { state: "shout", handler: { kind: "channel", channel: "" } },
      { state: "work", handler: { kind: "agent", agent: "w" } },
    ],
    transitions: [],
    layout: { nodes: { intake: { x: 0, y: 0 }, shout: { x: 300, y: 0 }, work: { x: 600, y: 0 } } },
  });

/** A model with `name` placed, and its views. */
const placed = (m: CanvasModel, name: string) => {
  const next = placeChannel(m, channelNodes(m), name);
  return { m: next, views: channelNodes(next), id: channelNodes(next).find((v) => v.channel === name)!.id };
};

describe("planWire — what a drag to or from a channel means", () => {
  it("agent out → channel sets its STARTER's sink — the results leave from the agent", () => {
    const { m, views, id } = placed(base(), "results");
    const w = planWire(m, views, { source: "agent:intake", target: id, sourceHandle: AGENT_HANDLE.out }, agentNodes(m));
    expect(w).toEqual({ state: "intake", field: "sink", channel: "results" });
  });

  it("does not wire a sink from the Starter itself — its data-out is the dispatch", () => {
    const { m, views, id } = placed(base(), "results");
    expect(planWire(m, views, { source: "intake", target: id, sourceHandle: HANDLE.dataOut }, agentNodes(m))).toBeNull();
  });

  it("publish node → channel sets its channel", () => {
    const { m, views, id } = placed(base(), "alerts");
    expect(planWire(m, views, { source: "shout", target: id, sourceHandle: HANDLE.dataOut })).toEqual({
      state: "shout",
      field: "channel",
      channel: "alerts",
    });
  });

  it("channel → Starter data-in sets the Starter's source", () => {
    const { m, views, id } = placed(base(), "tickets");
    expect(planWire(m, views, { source: id, target: "intake", targetHandle: HANDLE.dataIn })).toEqual({
      state: "intake",
      field: "source",
      channel: "tickets",
    });
  });

  it("refuses what the runtime cannot express", () => {
    const { m, views, id } = placed(base(), "x");
    // An agent reads and publishes no channel — the Starter is the ACL subject.
    expect(planWire(m, views, { source: "work", target: id, sourceHandle: HANDLE.dataOut })).toBeNull();
    expect(planWire(m, views, { source: id, target: "work", targetHandle: HANDLE.dataIn })).toBeNull();
    // A publish node does not read.
    expect(planWire(m, views, { source: id, target: "shout", targetHandle: HANDLE.dataIn })).toBeNull();
    // An agent node publishes only from its out handle.
    expect(planWire(m, views, { source: "agent:intake", target: id, sourceHandle: AGENT_HANDLE.in }, agentNodes(m))).toBeNull();
    // Only the DATA handles wire: a control handle never does.
    expect(planWire(m, views, { source: "intake", target: id, sourceHandle: HANDLE.sourceRight })).toBeNull();
    expect(planWire(m, views, { source: id, target: "intake", targetHandle: HANDLE.targetLeft })).toBeNull();
  });

  it("refuses two states — that is a transition, not a wire", () => {
    // Even onto a Starter's data-in, where a channel → Starter wire would
    // land: with no channel at either end there is no channel to set.
    const m = base();
    expect(planWire(m, channelNodes(m), { source: "work", target: "intake", targetHandle: HANDLE.dataIn })).toBeNull();
  });

  it("refuses channel → channel", () => {
    const one = placed(base(), "a");
    const two = placed(one.m, "b");
    expect(planWire(two.m, two.views, { source: one.id, target: two.id })).toBeNull();
  });
});

describe("applyWire", () => {
  it("REPLACES a Starter's source and keeps the rest of the block", () => {
    // A Starter reads exactly one channel; wait / n are the operator's.
    const m = applyWire(base(), { state: "intake", field: "source", channel: "tickets" });
    expect(handlerOf(m.nodes[0]).source).toEqual({ channel: "tickets", wait: "at_least", n: 3 });
  });

  it("writes a sink onto a Starter that had none", () => {
    const m = applyWire(base(), { state: "intake", field: "sink", channel: "results" });
    expect(handlerOf(m.nodes[0]).sink).toEqual({ channel: "results" });
  });

  it("makes the channel WIRED, so it is no longer removable", () => {
    const { m, id } = placed(base(), "results");
    const wired = applyWire(m, { state: "intake", field: "sink", channel: "results" });
    const v = channelNodes(wired).find((x) => x.id === id)!;
    expect(v.wired).toBe(true);
    expect(v.publishers).toEqual(["intake"]);
  });
});

describe("connectionKind", () => {
  it("never treats a drag on a DATA handle as a transition", () => {
    // Regression guard: a Starter always shows its data handles, and a drag
    // from one to an agent's left handle used to become a `success` edge.
    const m = base();
    const views = channelNodes(m);
    expect(connectionKind(m, views, { source: "intake", target: "work", sourceHandle: HANDLE.dataOut, targetHandle: HANDLE.targetLeft })).toBe("invalid");
    expect(connectionKind(m, views, { source: "intake", target: "work", sourceHandle: HANDLE.sourceBottom, targetHandle: HANDLE.targetLeft })).toBe("transition");
  });

  it("never transitions to or from an agent node — it is not a state", () => {
    const m = base();
    const agents = agentNodes(m);
    expect(connectionKind(m, channelNodes(m), { source: "agent:intake", target: "work", sourceHandle: AGENT_HANDLE.out, targetHandle: HANDLE.targetLeft }, agents)).toBe("invalid");
    expect(connectionKind(m, channelNodes(m), { source: "work", target: "agent:intake", sourceHandle: HANDLE.sourceRight, targetHandle: AGENT_HANDLE.in }, agents)).toBe("invalid");
  });

  it("classifies an accepted channel drag as a wire, and a refused one as invalid", () => {
    const { m, views, id } = placed(base(), "results");
    expect(connectionKind(m, views, { source: "agent:intake", target: id, sourceHandle: AGENT_HANDLE.out }, agentNodes(m))).toBe("wire");
    expect(connectionKind(m, views, { source: "work", target: id, sourceHandle: HANDLE.dataOut })).toBe("invalid");
  });
});

describe("placeChannel / removeChannel", () => {
  it("places a reference as layout only — no state, no content", () => {
    const m = base();
    const { m: next, id } = placed(m, "results");
    expect(next.nodes).toHaveLength(m.nodes.length);
    const out = toDefinition(next) as { states: unknown[]; layout: { nodes: Record<string, unknown> } };
    expect(out.states).toHaveLength(3);
    expect(out.layout.nodes[id]).toBeTruthy();
  });

  it("draws a placed channel as UNWIRED, clear of the graph", () => {
    const { views, id } = placed(base(), "results");
    const v = views.find((x) => x.id === id)!;
    expect(v.wired).toBe(false);
    expect(v.position.y).toBeLessThan(0);
  });

  it("does not place a channel twice — or move the one already drawn", () => {
    const m = base();
    const before = channelNodes(m).find((v) => v.channel === "inbox")!; // named by intake's source
    const after = placeChannel(m, channelNodes(m), "inbox");
    expect(after).toBe(m);
    expect(channelNodes(after).find((v) => v.channel === "inbox")!.position).toEqual(before.position);
  });

  it("auto-places a removed channel that is wired again, not at the position being dropped", () => {
    // Removing drops the saved key on save; drawing the channel at that stale
    // spot meanwhile would show a position the save is about to throw away.
    const saved = fromDefinition({ ...toDefinition(placed(base(), "results").m) });
    const v = channelNodes(saved).find((x) => x.channel === "results")!;
    expect(v.placed).toBe(true);
    const rewired = applyWire(removeChannel(saved, v), { state: "intake", field: "sink", channel: "results" });
    const again = channelNodes(rewired).find((x) => x.channel === "results")!;
    expect(again.placed).toBe(false);
  });

  it("removes an unwired channel, and drops its saved key on save", () => {
    const saved = fromDefinition({
      ...toDefinition(placed(base(), "results").m),
    });
    const v = channelNodes(saved).find((x) => x.channel === "results")!;
    const removed = removeChannel(saved, v);
    expect(channelNodes(removed).some((x) => x.channel === "results")).toBe(false);
    const out = toDefinition(removed) as { layout: { nodes: Record<string, unknown> } };
    expect(out.layout.nodes[v.id]).toBeUndefined();
  });

  it("refuses to remove a WIRED channel", () => {
    const m = base();
    const inbox = channelNodes(m).find((v) => v.channel === "inbox")!;
    expect(removeChannel(m, inbox)).toBe(m);
  });
});

describe("withGrant", () => {
  it("adds only what is missing, and respects a wildcard grant", () => {
    expect(withGrant({ subscribe: ["a"] }, "b", ["subscribe", "publish"])).toEqual({
      subscribe: ["a", "b"],
      publish: ["b"],
    });
    expect(withGrant({ publish: ["findings/*"] }, "findings/x", ["publish"])).toEqual({ publish: ["findings/*"] });
  });
});
