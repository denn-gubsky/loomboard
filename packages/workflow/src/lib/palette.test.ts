import { describe, expect, it } from "vitest";
import {
  PALETTE,
  PALETTE_GROUPS,
  entriesInGroup,
  newHandler,
  newStateRaw,
  nextNodeId,
  placeableEntries,
} from "./palette";
import { KNOWN_KINDS, fromDefinition } from "./model";
import { canSave, validateModel } from "./validate";

const empty = fromDefinition({ entry: "", states: [], transitions: [] });

describe("the palette — what it offers", () => {
  it("covers every handler kind the canvas renders", () => {
    // If a kind exists in the model but nowhere in the palette, it is a node
    // an operator can see in someone else's graph and never create.
    const offered = new Set(PALETTE.map((e) => e.kind).filter(Boolean));
    expect([...offered].sort()).toEqual([...KNOWN_KINDS].sort());
  });

  it("places every entry in a declared group", () => {
    for (const e of PALETTE) expect(PALETTE_GROUPS).toContain(e.group);
  });

  it("says node, not state, in every label AND hint (C12)", () => {
    // Hints render as `title` tooltips, so a textContent-only assertion misses
    // them — which is how "An end state" survived the rename.
    for (const e of PALETTE) {
      expect(e.label, e.id).not.toMatch(/\bstate\b/i);
      expect(e.hint, e.id).not.toMatch(/\bstate\b/i);
    }
  });

  it("groups by what a node DOES, not by what it compiles to", () => {
    // C12. A Starter and an Input form share a group because both are where
    // work ENTERS — not because they share a shape.
    expect(entriesInGroup("Sources").map((e) => e.id)).toEqual(["starter", "input", "trigger"]);
    expect(entriesInGroup("Work").map((e) => e.id)).toEqual(["agent", "parallel", "consolidator"]);
    expect(entriesInGroup("Data").map((e) => e.id)).toEqual(["vars", "publish"]);
    expect(entriesInGroup("End").map((e) => e.id)).toEqual(["terminal"]);
  });

  it("marks schedules and webhooks as EXTERNAL and places nothing for them", () => {
    // C11: the content hash covers states/transitions/channels, not a
    // ScheduleDef. A canvas that created one would make the workflow stop
    // being a single versioned artifact.
    const trigger = PALETTE.find((e) => e.id === "trigger")!;
    expect(trigger.external).toBe(true);
    expect(trigger.kind).toBeUndefined();
    expect(placeableEntries().map((e) => e.id)).not.toContain("trigger");
  });

  it("never offers an external entry as placeable", () => {
    for (const e of placeableEntries()) expect(e.external).toBeFalsy();
  });
});

describe("the palette — placing a node", () => {
  it("names a node after its ROLE, not state-N", () => {
    const starter = PALETTE.find((e) => e.id === "starter")!;
    expect(nextNodeId(empty, starter)).toBe("starter-1");
  });

  it("avoids collisions with ids already in the graph", () => {
    const m = fromDefinition({
      entry: "agent-1",
      states: [
        { state: "agent-1", handler: { kind: "agent", agent: "a" } },
        { state: "agent-2", handler: { kind: "agent", agent: "b" } },
      ],
      transitions: [],
    });
    expect(nextNodeId(m, PALETTE.find((e) => e.id === "agent")!)).toBe("agent-3");
  });

  it("writes a states[] entry the model can parse straight back", () => {
    const raw = newStateRaw(empty, PALETTE.find((e) => e.id === "vars")!);
    const m = fromDefinition({ entry: "vars-1", states: [raw], transitions: [] });
    expect(m.nodes[0].id).toBe("vars-1");
    expect(m.nodes[0].kind).toBe("vars");
    expect(m.nodes[0].opaque).toBe(false);
  });
});

describe("the palette — what a new node starts as", () => {
  it("gives a Starter a ceiling, because an absent one is the spawn hazard", () => {
    // fanout.max is the single default worth pre-filling: unset, the runtime
    // refuses it, and the reason is that a channel holding a thousand messages
    // otherwise becomes a thousand runs.
    const h = newHandler(PALETTE.find((e) => e.id === "starter")!) as {
      fanout: { max: number; per: string };
    };
    expect(h.fanout.max).toBeGreaterThan(0);
    expect(h.fanout.per).toBe("message");
  });

  it("leaves the CHOICES blank so the mirror names them", () => {
    // A default channel or agent would silently run against the wrong one.
    // Red-until-configured is the intended state of a fresh node.
    const m = fromDefinition({
      entry: "starter-1",
      states: [newStateRaw(empty, PALETTE.find((e) => e.id === "starter")!)],
      transitions: [],
    });
    expect(canSave(validateModel(m))).toBe(false);
    const msgs = validateModel(m).map((f) => f.message).join(" | ");
    expect(msgs).toMatch(/source\.channel/);
  });

  it("seeds a vars node with a valid placeholder rather than an empty set", () => {
    // An empty `set` is refused outright, so seeding one named key makes the
    // node legal the moment its value is typed.
    const h = newHandler(PALETTE.find((e) => e.id === "vars")!) as { set: Record<string, string> };
    expect(Object.keys(h.set)).toHaveLength(1);
    const m = fromDefinition({
      entry: "vars-1",
      states: [
        { state: "vars-1", handler: h },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "vars-1", to: "done", on: "success" }],
    });
    expect(canSave(validateModel(m))).toBe(true);
  });

  it("makes a terminal node immediately valid", () => {
    const m = fromDefinition({
      entry: "terminal-1",
      states: [newStateRaw(empty, PALETTE.find((e) => e.id === "terminal")!)],
      transitions: [],
    });
    expect(canSave(validateModel(m))).toBe(true);
  });

  it("produces a handler whose kind matches the entry, for every placeable entry", () => {
    for (const e of placeableEntries()) {
      expect((newHandler(e) as { kind: string }).kind, e.id).toBe(e.kind);
    }
  });
});
