// Where a live walk IS on the graph, for Run mode's colours.
//
// The walk's rows (lib/runs.ts) say which states started runs and how those
// runs stand. From them:
//
//   - active: a state with a run still going (running, held or waiting) — or,
//     in a gap where nothing runs (a Starter collecting its channel before it
//     dispatches), the state the walk is heading to next;
//   - passed: a state the walk has been through — every run it started has
//     settled, or it starts no runs (an Input, a vars state) and the walk has
//     moved beyond it;
//   - taken: the transitions the walk followed between those states.
//
// The runtime does not record which transition a walk took, so `taken` is
// read off the states' visit order: an edge from→to was taken when `to` was
// visited AFTER `from` was. That keeps an unused pushback edge (review → code)
// uncoloured until the walk actually goes back.
//
// A walk that has ended has no progress at all: Run mode resets its colours
// when the run completes, and what it produced stays on the End node.
//
// Pure: no React, no SDK.

import type { CanvasModel } from "./model";
import { instantMs, isTerminal, lastState, type WalkRunRow, type WalkView } from "./runs";

export interface WalkProgress {
  active: ReadonlySet<string>;
  passed: ReadonlySet<string>;
  /** Transition ids (lib/flow.ts edgeId: `from on to`). */
  taken: ReadonlySet<string>;
}

/** Kinds that start no runs, so they leave no rows: the walk passes through
 *  them in the same step that reaches them. */
const INSTANT = new Set(["input", "vars", "channel"]);

/** A state's visits as ordinals — the walk's `state_visit`, or failing that
 *  the run's instant, which orders the same way within one walk. */
function visitOrder(r: WalkRunRow): number {
  return r.stateVisit ?? instantMs(r.ts);
}

export function walkProgress(model: CanvasModel, view: WalkView | undefined): WalkProgress | undefined {
  if (!view || (view.walk && isTerminal(view.walk.status))) return undefined;

  const byState = new Map<string, WalkRunRow[]>();
  for (const r of view.members.values()) {
    if (r.state) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  }
  const kindOf = new Map(model.nodes.map((n) => [n.id, n.opaque ? "" : n.kind]));
  const successOf = (id: string) => {
    const out = model.edges.filter((e) => e.from === id);
    return (out.find((e) => e.on === "success") ?? out[0])?.to;
  };

  const active = new Set<string>();
  const passed = new Set<string>();
  for (const [state, rows] of byState) {
    if (rows.some((r) => !isTerminal(r.status))) active.add(state);
    else passed.add(state);
  }

  // A gap: the walk runs, yet nothing it started is live. It is between
  // states — heading to the successor of the state it ran last, or, before
  // anything ran, to its entry. Instant states on the way are passed through.
  if (!active.size) {
    const last = lastState(view);
    let next = last ? successOf(last) : model.entry;
    for (let hops = 0; next && INSTANT.has(kindOf.get(next) ?? "") && hops < model.nodes.length; hops++) {
      next = successOf(next);
    }
    if (next && kindOf.get(next) !== "terminal" && !passed.has(next)) active.add(next);
  }

  // An instant state is passed once the walk has reached a state after it:
  // the entry, or one fed by a state already passed. Iterated, since a chain
  // of them (input → vars → …) clears one per round.
  const reached = (id: string) => active.has(id) || passed.has(id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, kind] of kindOf) {
      if (!INSTANT.has(kind) || passed.has(id)) continue;
      const fed = id === model.entry || model.edges.some((e) => e.to === id && passed.has(e.from));
      const left = model.edges.some((e) => e.from === id && reached(e.to));
      if (fed && left) {
        passed.add(id);
        changed = true;
      }
    }
  }

  const first = (id: string) => Math.min(...(byState.get(id) ?? []).map(visitOrder));
  const latest = (id: string) => Math.max(...(byState.get(id) ?? []).map(visitOrder));
  const taken = new Set<string>();
  for (const e of model.edges) {
    // A state that ran may be running AGAIN (re-entered by a pushback) and
    // still have left by this edge before; an instant one has left only once
    // it is passed.
    const left = byState.has(e.from) ? reached(e.from) : passed.has(e.from);
    if (!left || !reached(e.to)) continue;
    // Both ends ran: `to` must have run after `from` first did. An instant
    // state on either end has no visits to compare and is taken on reach.
    if (byState.has(e.from) && byState.has(e.to) && !(latest(e.to) > first(e.from))) continue;
    taken.add(`${e.from} ${e.on} ${e.to}`);
  }
  return { active, passed, taken };
}
