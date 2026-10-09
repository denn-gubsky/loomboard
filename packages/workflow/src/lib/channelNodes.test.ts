import { describe, expect, it } from "vitest";
import { CHANNEL_CLEARANCE, CHANNEL_LIFT, CHANNEL_NODE_PREFIX, channelBacklog, channelNodeId, channelNodes } from "./channelNodes";
import { CHANNEL_LAYOUT_PREFIX, fromDefinition, toDefinition, type CanvasModel } from "./model";

const starter = (source?: string, sink?: string) => ({
  kind: "starter",
  ...(source ? { source: { channel: source } } : {}),
  fanout: { agent: "a", max: 2 },
  ...(sink ? { sink: { channel: sink } } : {}),
});

const def = (extra: Record<string, unknown> = {}) => ({
  entry: "intake",
  states: [
    { state: "intake", handler: starter("inbox", "raw") },
    { state: "triage", handler: starter("raw") },
  ],
  transitions: [{ from: "intake", to: "triage", on: "success" }],
  layout: { nodes: { intake: { x: 0, y: 0 }, triage: { x: 280, y: 0 } } },
  ...extra,
});

const view = (m: CanvasModel, name: string) => channelNodes(m).find((v) => v.channel === name)!;

describe("channelNodes — which channels, and who touches them", () => {
  it("draws each channel the graph names once, with its publishers and readers", () => {
    const m = fromDefinition(def());
    expect(channelNodes(m).map((v) => v.channel)).toEqual(["inbox", "raw"]);
    expect(view(m, "raw")).toMatchObject({ publishers: ["intake"], readers: ["triage"] });
    expect(view(m, "inbox")).toMatchObject({ publishers: [], readers: ["intake"] });
  });

  it("does not draw an opaque node's fields as wiring (decision 3)", () => {
    const m = fromDefinition({
      entry: "x",
      states: [{ state: "x", handler: { kind: "from-a-newer-runtime", channel: "mystery" } }],
      transitions: [],
    });
    expect(channelNodes(m)).toEqual([]);
  });

  it("steps aside from a state literally named like a channel node", () => {
    const m = fromDefinition({
      entry: "channel:raw",
      states: [{ state: "channel:raw", handler: starter(undefined, "raw") }],
      transitions: [],
    });
    const id = channelNodeId(m, "raw");
    expect(id).not.toBe("channel:raw");
    expect(id.startsWith(CHANNEL_NODE_PREFIX)).toBe(true);
  });

  it("shares one prefix with the model's layout writer", () => {
    expect(CHANNEL_NODE_PREFIX).toBe(CHANNEL_LAYOUT_PREFIX);
  });
});

describe("channelNodes — the ACL and the declaration", () => {
  it("reports, per side IN USE, whether the team's ACL grants it", () => {
    const m = fromDefinition(def({ channels: { subscribe: ["inbox", "raw"], publish: [] } }));
    expect(view(m, "raw").grants).toEqual({ publish: false, subscribe: true });
    // inbox is only read, so it needs no publish grant and none is reported.
    expect(view(m, "inbox").grants).toEqual({ subscribe: true });
  });

  it("says not-declared only when the list actually loaded", () => {
    const m = fromDefinition(def());
    expect(channelNodes(m).every((v) => v.declared === undefined)).toBe(true);
    const listed = channelNodes(m, [{ name: "raw", scope: "tenant" }]);
    expect(listed.find((v) => v.channel === "raw")!.declared).toBe(true);
    expect(listed.find((v) => v.channel === "inbox")!.declared).toBe(false);
  });
});

describe("channelNodes — a team's own channel", () => {
  const own = fromDefinition({
    entry: "write",
    local: { channels: { journal: { scope: "user" } } },
    states: [
      { state: "write", handler: { kind: "agent", agent: "a" } },
      { state: "note", handler: { kind: "channel", channel: "./journal" } },
      { state: "tell", handler: { kind: "channel", channel: "journal" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "write", to: "note", on: "success" },
      { from: "note", to: "tell", on: "success" },
      { from: "tell", to: "done", on: "success" },
    ],
  });
  const find = (views: ReturnType<typeof channelNodes>, name: string) => views.find((v) => v.channel === name)!;

  it("takes its counts from the team's own listing, by its local name", () => {
    const views = channelNodes(own, [], [{ name: "journal", scope: "user", message_count: 3, held_count: 1 }]);
    expect(find(views, "./journal").info).toEqual({ name: "journal", scope: "user", message_count: 3, held_count: 1 });
    expect(find(views, "./journal").declared).toBe(true);
  });

  it("never takes them from a global channel of the same name, or the reverse", () => {
    const views = channelNodes(own, [{ name: "journal", scope: "tenant", message_count: 9 }], [{ name: "journal", scope: "user", message_count: 3 }]);
    expect(find(views, "./journal").info?.message_count).toBe(3);
    expect(find(views, "journal").info?.message_count).toBe(9);
    // With no listing of the team's own, the global one is not borrowed.
    expect(find(channelNodes(own, [{ name: "journal", scope: "tenant", message_count: 9 }]), "./journal").info).toBeUndefined();
  });
});

describe("channelNodes — where they are drawn", () => {
  it("auto-places an unplaced channel above the middle of what it connects", () => {
    // inbox (sorted first) is read only by intake at (0,0): directly above it.
    const inbox = view(fromDefinition(def()), "inbox");
    expect(inbox.placed).toBe(false);
    expect(inbox.position).toEqual({ x: 0, y: -CHANNEL_LIFT });
  });

  it("steps a channel right until it is clear of those already placed", () => {
    // raw's own spot, above the middle of intake and triage, is x=140 — within
    // a channel's width of inbox at x=0, so it moves one clearance right.
    const raw = view(fromDefinition(def()), "raw");
    expect(raw.position).toEqual({ x: 140 + CHANNEL_CLEARANCE.x, y: -CHANNEL_LIFT });
  });

  it("does not stack two channels between the same states on one spot", () => {
    const m = fromDefinition({
      entry: "a",
      states: [
        { state: "a", handler: { ...starter(undefined, "x"), sink: { channel: "x" } } },
        { state: "b", handler: starter("x") },
        { state: "c", handler: { kind: "channel", channel: "y" } },
      ],
      transitions: [],
      layout: { nodes: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } } },
    });
    const [x, y] = channelNodes(m);
    // Clear of each other, not merely different: a channel renders ~230px
    // wide, and a 70px nudge overlapped them in the browser.
    expect(Math.abs(x.position.x - y.position.x)).toBeGreaterThanOrEqual(CHANNEL_CLEARANCE.x);
  });

  it("uses a stored position from the layout", () => {
    const m = fromDefinition(def({ layout: { nodes: { intake: { x: 0, y: 0 }, "channel:raw": { x: 5, y: 6 } } } }));
    expect(view(m, "raw")).toMatchObject({ position: { x: 5, y: 6 }, placed: true });
  });

  it("uses an unsaved drag over the stored position", () => {
    const m = { ...fromDefinition(def()), derivedPositions: { "channel:raw": { x: 9, y: 9 } } };
    expect(view(m, "raw").position).toEqual({ x: 9, y: 9 });
  });
});

describe("toDefinition — channel positions in layout.nodes", () => {
  it("writes a dragged channel's position, rounded, beside the states'", () => {
    const m = { ...fromDefinition(def()), layoutDirty: true, derivedPositions: { "channel:raw": { x: 10.6, y: -3.2 } } };
    const out = toDefinition(m) as { layout: { nodes: Record<string, unknown> } };
    expect(out.layout.nodes["channel:raw"]).toEqual({ x: 11, y: -3 });
  });

  it("KEEPS saved channel positions when only a state moves", () => {
    // The trap: the layout is rebuilt from the states, and channel positions
    // belong to no state — rebuilding from states alone would drop them all.
    const m = fromDefinition(def({ layout: { nodes: { intake: { x: 0, y: 0 }, "channel:raw": { x: 5, y: 6 } } } }));
    const moved = { ...m, layoutDirty: true, nodes: m.nodes.map((n) => ({ ...n, position: { x: 1, y: 1 } })) };
    const out = toDefinition(moved) as { layout: { nodes: Record<string, unknown> } };
    expect(out.layout.nodes["channel:raw"]).toEqual({ x: 5, y: 6 });
  });

  it("keeps every DERIVED node's saved position, not only channels'", () => {
    // Bindings (lib/bindings.ts) share the map under their own prefix.
    const m = fromDefinition(
      def({ layout: { nodes: { intake: { x: 0, y: 0 }, "binding:document:/specs/a": { x: 3, y: 4 } } } }),
    );
    const out = toDefinition({ ...m, layoutDirty: true }) as { layout: { nodes: Record<string, unknown> } };
    expect(out.layout.nodes["binding:document:/specs/a"]).toEqual({ x: 3, y: 4 });
  });

  it("never overwrites a state's own layout entry with a channel's", () => {
    const m = fromDefinition({
      entry: "channel:raw",
      states: [{ state: "channel:raw", handler: starter(undefined, "raw") }],
      transitions: [],
    });
    const dirty = { ...m, layoutDirty: true, derivedPositions: { "channel:raw": { x: 99, y: 99 } } };
    const out = toDefinition(dirty) as { layout: { nodes: Record<string, { x: number }> } };
    expect(out.layout.nodes["channel:raw"].x).not.toBe(99);
  });

  it("writes nothing for an auto-placed channel nobody moved", () => {
    const m = { ...fromDefinition(def()), layoutDirty: true };
    const out = toDefinition(m) as { layout: { nodes: Record<string, unknown> } };
    expect(Object.keys(out.layout.nodes).some((k) => k.startsWith("channel:"))).toBe(false);
  });
});

describe("channelBacklog", () => {
  it("separates what a reader can see from what is stored", () => {
    expect(channelBacklog({ name: "c", message_count: 10, held_count: 3, awaiting_hooks_count: 2 })).toBe(
      "5 readable · 3 held · 2 awaiting hooks",
    );
    expect(channelBacklog({ name: "c", message_count: 0 })).toBe("0 readable");
    expect(channelBacklog(undefined)).toBeUndefined();
  });
});
