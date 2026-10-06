import { describe, expect, it } from "vitest";
import { forkOverlay } from "./fork";
import type { JsonObject } from "./model";
import {
  contentKey,
  fromDefinition,
  handlerAgents,
  handlerOf,
  patchHandler,
  teamChannels,
  toDefinition,
  walkHooks,
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
      // A kind this canvas does not know. Deliberately FICTIONAL rather than a
      // real not-yet-implemented kind: the invariant under test is "an unknown
      // kind survives verbatim", and naming a real one means the test breaks —
      // or worse, quietly changes meaning — the day that kind ships.
      handler: {
        kind: "from-a-newer-runtime",
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
    expect(intake.kind).toBe("from-a-newer-runtime");
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

  it("writes positions as INTEGERS, because the runtime decodes them as ints", () => {
    // Regression: xyflow reports a drag at zoom 0.575 as e.g. 337.357, and
    // teamgraph.NodePos{X, Y int} refuses a fraction while decoding, so every
    // save after a drag failed with "cannot unmarshal number … of type int".
    const m = fromDefinition(MINIMAL);
    const moved = {
      ...m,
      layoutDirty: true,
      nodes: m.nodes.map((n, i) => (i === 0 ? { ...n, position: { x: 337.357, y: -34.5 } } : n)),
    };
    const out = toDefinition(moved) as { layout: { nodes: Record<string, { x: number; y: number }> } };
    const p = out.layout.nodes[m.nodes[0].id];
    expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    expect(p).toEqual({ x: 337, y: -34 });
  });

  it("keeps a node's stored size when it is moved", () => {
    const m = fromDefinition({ ...MINIMAL, layout: { nodes: { [MINIMAL.states[0].state]: { x: 0, y: 0, w: 240, h: 90 } } } });
    const out = toDefinition({ ...m, layoutDirty: true }) as { layout: { nodes: Record<string, unknown> } };
    expect(out.layout.nodes[MINIMAL.states[0].state]).toMatchObject({ w: 240, h: 90 });
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
    expect(patchHandler(n, { kind: "from-a-newer-runtime" }).opaque).toBe(true);
    expect(patchHandler(n, { kind: "consolidator" }).opaque).toBe(false);
  });

  it("drops an edit that returns to the saved value, back onto the fast path", () => {
    const m = fromDefinition(MINIMAL);
    const edited = patchHandler(m.nodes[0], { agent: "b" });
    expect(handlerOf(edited).agent).toBe("b");

    const back = patchHandler(edited, { agent: "a" });
    expect(back.handlerPatch).toBeUndefined();
    expect(back.handlerRemoved).toBeUndefined();
    expect(JSON.stringify(toDefinition({ ...m, nodes: [back, m.nodes[1]] }))).toBe(
      JSON.stringify(MINIMAL),
    );
  });

  it("REMOVES a key the saved definition has when it is cleared", () => {
    // The regression: clearing used to delete only the PATCH entry, so the
    // saved value snapped back and a key could never leave the definition —
    // an operator could not remove a hook, a timeout or a consolidator.
    const saved = {
      entry: "s",
      states: [
        { state: "s", handler: { kind: "agent", agent: "a", timeout_ms: 5000, consolidator: "j" } },
      ],
      transitions: [],
    };
    const m = fromDefinition(saved);
    const cleared = patchHandler(m.nodes[0], { timeout_ms: undefined });
    expect(handlerOf(cleared).timeout_ms).toBeUndefined();

    const out = toDefinition({ ...m, nodes: [cleared] }) as typeof saved;
    // Gone, and the remaining keys keep their order.
    expect(Object.keys(out.states[0].handler)).toEqual(["kind", "agent", "consolidator"]);
  });

  it("drops a key only the patch had without leaving a removal behind", () => {
    const m = fromDefinition(MINIMAL);
    const added = patchHandler(m.nodes[0], { timeout_ms: 1000 });
    const cleared = patchHandler(added, { timeout_ms: undefined });
    expect(cleared.handlerPatch).toBeUndefined();
    expect(cleared.handlerRemoved).toBeUndefined();
  });

  it("restores a cleared key when it is set again", () => {
    const m = fromDefinition(MINIMAL);
    const cleared = patchHandler(m.nodes[0], { agent: undefined });
    expect(cleared.handlerRemoved).toEqual(["agent"]);
    const again = patchHandler(cleared, { agent: "a" });
    expect(again.handlerRemoved).toBeUndefined();
    expect(JSON.stringify(toDefinition({ ...m, nodes: [again, m.nodes[1]] }))).toBe(
      JSON.stringify(MINIMAL),
    );
  });

  it("reads the kind from the saved handler when a kind edit is reverted", () => {
    const m = fromDefinition(MINIMAL);
    const n = m.nodes[0];
    const edited = patchHandler(n, { kind: "consolidator" });
    expect(edited.kind).toBe("consolidator");
    expect(patchHandler(edited, { kind: n.kind }).kind).toBe(n.kind);
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

describe("team channels", () => {
  const withACL = {
    entry: "s",
    channels: { subscribe: ["inbox"], publish: ["done"] },
    states: [{ state: "s", handler: { kind: "terminal" } }],
    transitions: [],
  };

  it("reads the ACL the definition carries", () => {
    expect(teamChannels(fromDefinition(withACL))).toEqual({
      subscribe: ["inbox"],
      publish: ["done"],
    });
  });

  it("reports an empty ACL for a team that declares none", () => {
    expect(teamChannels(fromDefinition(MINIMAL))).toEqual({});
  });

  it("leaves `channels` untouched until the operator edits it", () => {
    // The same rule as `layout` (decision 5): merely OPENING a team must never
    // change what a save would write.
    const m = fromDefinition(withACL);
    expect(toDefinition(m)).toEqual(withACL);
    expect(JSON.stringify(toDefinition(m))).toBe(JSON.stringify(withACL));
  });

  it("writes an edited ACL back", () => {
    const m = { ...fromDefinition(withACL), channelsPatch: { subscribe: ["a", "b"], publish: [] } };
    expect(toDefinition(m).channels).toEqual({ subscribe: ["a", "b"] });
  });

  it("trims and drops blank entries rather than persisting them", () => {
    const m = { ...fromDefinition(withACL), channelsPatch: { subscribe: [" a ", "", "b"] } };
    expect(toDefinition(m).channels).toEqual({ subscribe: ["a", "b"] });
  });

  it("an emptied ACL leaves the draft, and the save sends {} — a fork keeps the parent's value for an omitted key", () => {
    // Regression (#105): the emptied ACL never reached the runtime
    // (teamdef.go applyTeamOverlay replaces Channels only when sent).
    const m = { ...fromDefinition(withACL), channelsPatch: { subscribe: [], publish: [] } };
    expect("channels" in toDefinition(m)).toBe(false);
    expect(forkOverlay(withACL as unknown as JsonObject, toDefinition(m)).channels).toEqual({});
    // A team that never had an ACL gains no key.
    expect("channels" in toDefinition({ ...fromDefinition(MINIMAL), channelsPatch: { subscribe: [] } })).toBe(false);
  });

  it("an edited ACL survives alongside everything else the canvas preserves", () => {
    const m = { ...fromDefinition(FORWARD_COMPAT), channelsPatch: { publish: ["x"] } };
    const out = toDefinition(m);
    expect(out.channels).toEqual({ publish: ["x"] });
    expect(out.max_iterations).toBe(FORWARD_COMPAT.max_iterations);
    expect(out.states).toEqual(FORWARD_COMPAT.states);
  });
});

describe("walk hooks (RFC DK-P4c)", () => {
  const withHooks = {
    entry: "s",
    states: [
      { state: "s", handler: { kind: "agent", agent: "a" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "s", to: "done", on: "success" }],
    hooks: { run_end: ["notify-owner"] },
  };

  it("round-trips untouched walk hooks byte-identically", () => {
    expect(JSON.stringify(toDefinition(fromDefinition(withHooks)))).toBe(JSON.stringify(withHooks));
  });

  it("reads the saved hooks until they are edited", () => {
    expect(walkHooks(fromDefinition(withHooks))).toEqual({ run_end: ["notify-owner"] });
  });

  it("writes an edit", () => {
    const m = { ...fromDefinition(withHooks), walkHooksPatch: { hooks: { run_end: ["page-oncall"] } } };
    expect(toDefinition(m).hooks).toEqual({ run_end: ["page-oncall"] });
  });

  it("cleared hooks leave the draft, and the save sends {} — a fork keeps the parent's hooks for an omitted key", () => {
    // Regression (#105): cleared hooks stayed in force.
    const m = { ...fromDefinition(withHooks), walkHooksPatch: { hooks: undefined } };
    expect("hooks" in toDefinition(m)).toBe(false);
    expect(forkOverlay(withHooks as unknown as JsonObject, toDefinition(m)).hooks).toEqual({});
    const empty = { ...fromDefinition(withHooks), walkHooksPatch: { hooks: {} } };
    expect(forkOverlay(withHooks as unknown as JsonObject, toDefinition(empty)).hooks).toEqual({});
    // A definition that never had hooks gains no key.
    const { hooks: _h, ...none } = withHooks;
    expect("hooks" in toDefinition({ ...fromDefinition(none), walkHooksPatch: { hooks: undefined } })).toBe(false);
  });
});

describe("contentKey", () => {
  const def = {
    entry: "a",
    states: [{ state: "a", handler: { kind: "agent", agent: "x" } }, { state: "b", handler: { kind: "terminal" } }],
    transitions: [{ from: "a", to: "b", on: "success" }],
  };

  it("ignores layout, colours and key order — they do not change what runs", () => {
    const m = fromDefinition(def);
    const moved = { ...fromDefinition({ ...def, layout: { nodes: { a: { x: 5, y: 5 } } }, colors: { a: "#f00" } }), layoutDirty: true };
    const reordered = fromDefinition({ transitions: def.transitions, states: def.states, entry: "a" });
    expect(contentKey(moved)).toBe(contentKey(m));
    expect(contentKey(reordered)).toBe(contentKey(m));
  });

  it("changes when the content does", () => {
    const m = fromDefinition(def);
    const edited = { ...m, nodes: m.nodes.map((n) => (n.id === "a" ? patchHandler(n, { agent: "y" }) : n)) };
    expect(contentKey(edited)).not.toBe(contentKey(m));
  });
});

describe("the team's own definitions (localPatch, RFC DV)", () => {
  const withLocal = {
    entry: "s",
    states: [{ state: "s", handler: { kind: "agent", agent: "./a" } }, { state: "done", handler: { kind: "terminal" } }],
    transitions: [{ from: "s", to: "done", on: "success" }],
    local: { agents: { a: { tier: "low" } }, channels: { c: { scope: "tenant" } } },
  };

  it("round-trips an untouched local block byte-identically", () => {
    expect(JSON.stringify(toDefinition(fromDefinition(withLocal)))).toBe(JSON.stringify(withLocal));
  });

  it("replaces only the kinds edited, wholesale", () => {
    const m = { ...fromDefinition(withLocal), localPatch: { agents: { b: {} } } };
    expect(toDefinition(m).local).toEqual({ agents: { b: {} }, channels: { c: { scope: "tenant" } } });
  });
});
