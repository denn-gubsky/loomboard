import { describe, expect, it } from "vitest";
import {
  fromDefinition,
  handlerAgents,
  handlerOf,
  patchHandler,
  toDefinition,
  type CanvasModel,
} from "./model";

// The round trip is RFC CZ's P0 gate. `TeamsView.tsx` — and with it the raw
// JSON textarea — can only be deleted once these pass, because after that the
// canvas is the ONLY editor and anything it drops is unrecoverable.

/** A definition exercising every category the canvas must preserve but does not
 *  understand: an unknown handler kind, unknown fields on a KNOWN kind, an
 *  unknown top-level key, and a state-level key outside `state`/`handler`. */
const FORWARD_COMPAT = {
  entry: "intake",
  max_iterations: 7,
  // RFC CY adds this; a P0 canvas has never heard of it.
  channels: { subscribe: ["pr-events"], publish: ["verdicts"] },
  states: [
    {
      state: "intake",
      // A kind from a later CY phase. Must render opaque and survive verbatim.
      handler: {
        kind: "starter",
        source: { channel: "pr-events", wait: "any", wait_ms: 30000, batch: 8 },
        fanout: { agent: "reviewer", per: "message", max: 8 },
        prompt: { system: "You are a security reviewer.", input: "{{starter.message}}" },
        sink: { channel: "verdicts" },
        ack: "after_results",
      },
    },
    {
      state: "review",
      // A KNOWN kind carrying fields this canvas version does not model.
      handler: {
        kind: "agent",
        agent: "reviewer",
        input_template: "Review it.",
        some_future_field: { nested: [1, 2, 3] },
      },
      // A state-level key outside state/handler.
      annotation: "hand-authored",
    },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "intake", to: "review", on: "success" },
    { from: "review", to: "done", on: "success", note: "unknown edge key" },
  ],
  colors: { transitions: { success: "#4ade80" } },
  layout: { nodes: { intake: { x: 10, y: 20 } } },
};

const MINIMAL = {
  entry: "start",
  states: [
    { state: "start", handler: { kind: "agent", agent: "a" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [{ from: "start", to: "done", on: "success" }],
};

describe("fromDefinition", () => {
  it("marks a handler kind this canvas version does not know as opaque", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    const intake = m.nodes.find((n) => n.id === "intake")!;
    expect(intake.kind).toBe("starter");
    expect(intake.opaque).toBe(true);
  });

  it("marks the four shipped kinds as renderable", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    expect(m.nodes.find((n) => n.id === "review")!.opaque).toBe(false);
    expect(m.nodes.find((n) => n.id === "done")!.opaque).toBe(false);
  });

  it("reads stored positions and staggers the ones with none", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    expect(m.nodes.find((n) => n.id === "intake")!.position).toEqual({ x: 10, y: 20 });
    // `review` has no stored position; it must not collide with `done` at 0,0.
    const review = m.nodes.find((n) => n.id === "review")!.position;
    const done = m.nodes.find((n) => n.id === "done")!.position;
    expect(review).not.toEqual(done);
  });

  it("defaults an absent transition label to success, matching the walk", () => {
    const m = fromDefinition({ ...MINIMAL, transitions: [{ from: "start", to: "done" }] });
    expect(m.edges[0].on).toBe("success");
  });

  it("yields a renderable model from a malformed definition rather than throwing", () => {
    for (const bad of [null, undefined, 42, "nope", [], { states: "not an array" }]) {
      const m = fromDefinition(bad);
      expect(m.nodes).toEqual([]);
      expect(m.edges).toEqual([]);
    }
  });
});

describe("toDefinition", () => {
  it("round-trips an unedited definition byte-identically", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    expect(JSON.stringify(toDefinition(m))).toBe(JSON.stringify(FORWARD_COMPAT));
  });

  it("round-trips a minimal definition byte-identically", () => {
    const m = fromDefinition(MINIMAL);
    expect(JSON.stringify(toDefinition(m))).toBe(JSON.stringify(MINIMAL));
  });

  it("preserves an unknown handler kind and every field under it", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    // Edit a DIFFERENT node, so the opaque one takes the patched path's
    // neighbour rather than the untouched fast path.
    m.nodes = m.nodes.map((n) =>
      n.id === "review" ? patchHandler(n, { agent: "other-reviewer" }) : n,
    );
    const out = toDefinition(m) as unknown as typeof FORWARD_COMPAT;
    expect(out.states[0]).toEqual(FORWARD_COMPAT.states[0]);
  });

  it("preserves unknown fields on a known kind when a sibling field is edited", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    m.nodes = m.nodes.map((n) =>
      n.id === "review" ? patchHandler(n, { agent: "other-reviewer" }) : n,
    );
    const out = toDefinition(m) as unknown as typeof FORWARD_COMPAT;
    const h = out.states[1].handler as unknown as Record<string, unknown>;
    expect(h.agent).toBe("other-reviewer");
    expect(h.input_template).toBe("Review it.");
    expect(h.some_future_field).toEqual({ nested: [1, 2, 3] });
    // The state-level key outside state/handler survives too.
    expect((out.states[1] as Record<string, unknown>).annotation).toBe("hand-authored");
  });

  it("preserves unknown top-level keys", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    const out = toDefinition(m) as unknown as Record<string, unknown>;
    expect(out.channels).toEqual(FORWARD_COMPAT.channels);
    expect(out.colors).toEqual(FORWARD_COMPAT.colors);
    expect(out.max_iterations).toBe(7);
  });

  it("preserves unknown keys on a transition", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    const out = toDefinition(m) as unknown as typeof FORWARD_COMPAT;
    expect(out.transitions[1]).toEqual(FORWARD_COMPAT.transitions[1]);
  });

  // RFC CZ decision 5: opening a team to look at it must never fork it, so
  // layout is written only after the operator actually moves something.
  it("does not write layout for a definition that had none until it is dirtied", () => {
    const m = fromDefinition(MINIMAL);
    expect("layout" in toDefinition(m)).toBe(false);

    const moved: CanvasModel = {
      ...m,
      layoutDirty: true,
      nodes: m.nodes.map((n) => (n.id === "start" ? { ...n, position: { x: 99, y: 5 } } : n)),
    };
    const out = toDefinition(moved) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    expect(out.layout.nodes.start).toEqual({ x: 99, y: 5 });
  });

  it("leaves an existing layout untouched when nothing was moved", () => {
    const m = fromDefinition(FORWARD_COMPAT);
    const out = toDefinition(m) as unknown as typeof FORWARD_COMPAT;
    expect(out.layout).toEqual(FORWARD_COMPAT.layout);
  });
});

describe("patchHandler", () => {
  it("re-evaluates opacity when the kind itself is edited", () => {
    const m = fromDefinition(MINIMAL);
    const n = m.nodes[0];
    expect(patchHandler(n, { kind: "starter" }).opaque).toBe(true);
    expect(patchHandler(n, { kind: "consolidator" }).opaque).toBe(false);
  });

  it("clears a field back to the raw value rather than shadowing it", () => {
    const m = fromDefinition(MINIMAL);
    const edited = patchHandler(m.nodes[0], { agent: "b" });
    expect(handlerOf(edited).agent).toBe("b");

    const reverted = patchHandler(edited, { agent: undefined });
    expect(handlerOf(reverted).agent).toBe("a");
    expect(reverted.handlerPatch).toBeUndefined();
    // And with no patch left it takes the byte-identical fast path again.
    expect(JSON.stringify(toDefinition({ ...m, nodes: [reverted, m.nodes[1]] }))).toBe(
      JSON.stringify(MINIMAL),
    );
  });
});

describe("handlerAgents", () => {
  it("reads agent, agents[] and consolidator in that order", () => {
    const mk = (h: Record<string, unknown>) =>
      fromDefinition({ states: [{ state: "s", handler: h }] }).nodes[0];
    expect(handlerAgents(mk({ kind: "agent", agent: "a" }))).toEqual(["a"]);
    expect(handlerAgents(mk({ kind: "parallel", agents: ["a", "b"] }))).toEqual(["a", "b"]);
    expect(handlerAgents(mk({ kind: "consolidator", consolidator: "j" }))).toEqual(["j"]);
    expect(handlerAgents(mk({ kind: "terminal" }))).toEqual([]);
  });
});
