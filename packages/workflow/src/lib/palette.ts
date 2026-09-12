// The node palette — RFC CZ decisions C11 and C12.
//
// WHY this replaces "Add state": a TeamDef began as a task workflow, where a
// unit of work moves through statuses and `task.State` persists as a Document
// chunk's `status`. "State" meant "a column a card sits in", and that was
// accurate while the only kinds were agent / parallel / consolidator /
// terminal.
//
// RFC CY L2 and L4 added four kinds that are not statuses at all: a `starter`
// is a dispatcher, a `channel` node is an action, `vars` is an assignment, and
// `input` is a form declaration. A board-bound walk entered at a Starter writes
// `chunk.status = "intake"` — a kanban column named after a dispatcher. The
// walk is unchanged and still correct; it is the VOCABULARY that stopped
// describing the thing.
//
// So the palette groups entries by what a node DOES (C12), and the word
// "state" leaves the canvas. That most entries compile to a `states[]` element
// is an implementation detail of the wire format, like `layout`.
//
// C11 — EXTERNAL entries are referenced, never created here. A schedule is a
// ScheduleDef with `delivery: channel`; a webhook is a WebhookDef with the
// same shape; both publish a message and start no run. They live OUTSIDE the
// definition, and the TeamDef's content hash does not cover them — so a canvas
// that created one would produce a workflow that is no longer a single
// versioned artifact. They are drawn as context and owned elsewhere.
//
// Pure: no React, no network.

import type { CanvasModel, JsonObject } from "./model";

export type PaletteGroup = "Sources" | "Work" | "Data" | "End";

export const PALETTE_GROUPS: readonly PaletteGroup[] = ["Sources", "Work", "Data", "End"];

export interface PaletteEntry {
  /** Stable key, and the prefix for generated node ids. */
  id: string;
  label: string;
  group: PaletteGroup;
  hint: string;
  /** The handler kind placed into `states[]`. Absent on an external entry,
   *  which the canvas draws but does not own (C11). */
  kind?: string;
  /** True for a substrate object that lives outside this definition. */
  external?: boolean;
}

export const PALETTE: readonly PaletteEntry[] = [
  // ---- Sources: where work enters the graph ----
  {
    id: "starter",
    label: "Starter",
    group: "Sources",
    kind: "starter",
    hint: "Reads one channel and dispatches a wave of agent runs. The workflow's front door.",
  },
  {
    id: "input",
    label: "Input form",
    group: "Sources",
    kind: "input",
    hint: "A JSON Schema a client renders as this workflow's start form.",
  },
  {
    id: "trigger",
    label: "Schedule / WebHook",
    group: "Sources",
    external: true,
    hint:
      "A ScheduleDef or WebhookDef with delivery: channel — it publishes a message and starts " +
      "no run; a Starter reads that channel. Created in the Library, referenced here.",
  },

  // ---- Work: states that run agents ----
  {
    id: "agent",
    label: "Agent",
    group: "Work",
    kind: "agent",
    hint: "Runs one AgentDef. Add a consolidator to let it choose its outgoing edge.",
  },
  {
    id: "parallel",
    label: "Parallel",
    group: "Work",
    kind: "parallel",
    hint: "Fans out to several AgentDefs at once, then a consolidator picks the edge.",
  },
  {
    id: "consolidator",
    label: "Consolidator",
    group: "Work",
    kind: "consolidator",
    hint: "Reads the previous output and names the outgoing edge on a signal: line.",
  },

  // ---- Data: what the walk carries ----
  {
    id: "vars",
    label: "Variables",
    group: "Data",
    kind: "vars",
    hint: "Assigns ${var.*}. Its own node kind so an assignment is visible rather than hidden.",
  },
  {
    id: "publish",
    label: "Publish to channel",
    group: "Data",
    kind: "channel",
    hint: "Publishes to a channel. Reading one is what a Starter does.",
  },

  // ---- End ----
  {
    id: "terminal",
    label: "End",
    group: "End",
    kind: "terminal",
    hint: "An end node. The walk stops here.",
  },
];

/** Entries that place a node into the definition. */
export function placeableEntries(): PaletteEntry[] {
  return PALETTE.filter((e) => !e.external);
}

export function entriesInGroup(group: PaletteGroup): PaletteEntry[] {
  return PALETTE.filter((e) => e.group === group);
}

/** A unique node id for a new entry, named after its ROLE rather than
 *  "state-N" — the id is the first thing an operator reads on the node face,
 *  and `starter-1` says more than `state-3`. */
export function nextNodeId(model: CanvasModel, entry: PaletteEntry): string {
  const taken = new Set(model.nodes.map((n) => n.id));
  let i = 1;
  while (taken.has(`${entry.id}-${i}`)) i++;
  return `${entry.id}-${i}`;
}

/** The handler a freshly placed node starts with.
 *
 *  Scaffolding only — enough for the inspector to render the right groups, and
 *  deliberately NOT enough to be valid where the runtime requires a choice. A
 *  new Starter with no source channel SHOULD be red: the validation mirror
 *  naming what is missing is better than a default that silently runs against
 *  the wrong channel. The one exception is `fanout.max`, which has a safe
 *  non-zero default because leaving it unset is the spawn-amplifier hazard. */
export function newHandler(entry: PaletteEntry): JsonObject {
  switch (entry.kind) {
    case "agent":
      return { kind: "agent", agent: "" };
    case "parallel":
      return { kind: "parallel", agents: [], consolidator: "" };
    case "consolidator":
      return { kind: "consolidator", agent: "" };
    case "starter":
      return {
        kind: "starter",
        source: { channel: "" },
        fanout: { agent: "", per: "message", max: 8 },
        sink: { channel: "" },
      };
    case "channel":
      return { kind: "channel", channel: "" };
    case "vars":
      // One seeded pair: an empty `set` is refused by the runtime, and a named
      // key with an empty value is both valid and obviously a placeholder.
      return { kind: "vars", set: { value: "" } };
    case "input":
      return { kind: "input" };
    case "terminal":
      return { kind: "terminal" };
    default:
      return { kind: entry.kind ?? "agent" };
  }
}

/** The `states[]` entry for a newly placed palette item. */
export function newStateRaw(model: CanvasModel, entry: PaletteEntry): JsonObject {
  return { state: nextNodeId(model, entry), handler: newHandler(entry) };
}
