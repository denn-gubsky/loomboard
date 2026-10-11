// What a walk's decision states answered (loomcycle 1.110).
//
// A decision state starts no run, and the canvas starts every walk detached,
// which returns no steps. So the walk's own run records each visit to a
// decision state — the transition taken and the model's answer — and the host
// hands those records over one at a time (`watchWalkDecisions`).
//
// A record is the runtime's, read off a stream that replays from the walk's
// start: it can arrive twice, and a later runtime may add fields. So a record
// is checked before it is kept, and kept once per visit.
//
// Pure: no React, no network.

import type { WalkDecision } from "../types";
import { answerRows, percent } from "./decisionAnswer";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The record in `raw`, or undefined when it is not one. */
export function readDecision(raw: unknown): WalkDecision | undefined {
  if (!isObj(raw)) return undefined;
  const { state, visit, edge, next, answer } = raw;
  if (typeof state !== "string" || !state) return undefined;
  if (typeof visit !== "number" || !Number.isInteger(visit)) return undefined;
  if (typeof edge !== "string" || typeof next !== "string") return undefined;
  const a = isObj(answer) ? answer : {};
  return {
    state,
    visit,
    edge,
    next,
    answer: {
      ...(typeof a.model === "string" ? { model: a.model } : {}),
      ...(typeof a.provider === "string" ? { provider: a.provider } : {}),
      ...(typeof a.served_model === "string" ? { served_model: a.served_model } : {}),
      answers: isObj(a.answers) ? a.answers : {},
      ...(isObj(a.usage) ? { usage: a.usage as WalkDecision["answer"]["usage"] } : {}),
    },
  };
}

/** `list` with `d` in it: one record per visit, in visit order. The same list
 *  comes back when the visit is already there, so a replay redraws nothing. */
export function foldDecision(list: readonly WalkDecision[], d: WalkDecision): readonly WalkDecision[] {
  if (list.some((x) => x.visit === d.visit)) return list;
  return [...list, d].sort((x, y) => x.visit - y.visit);
}

/** One state's visits, latest first. */
export function decisionsOf(list: readonly WalkDecision[], state: string): WalkDecision[] {
  return list.filter((d) => d.state === state).reverse();
}

/** The answer a transition stands for: `billing` for `conditional:billing`. */
function routedAnswer(edge: string): string | undefined {
  return edge.startsWith("conditional:") ? edge.slice("conditional:".length) : undefined;
}

/** A visit in a few words, for the node's face: "billing 91% → billing-desk".
 *  `route` is the question whose answer routes the walk, when the state has
 *  one; its probability is shown as the model gave it, never graded. */
export function decisionFace(d: WalkDecision, route?: string): string {
  const row = route ? answerRows(d.answer).find((r) => r.question === route) : undefined;
  let said = routedAnswer(d.edge);
  if (row?.type === "choice") {
    const p = row.options.find((o) => o.name === row.choice)?.probability;
    said = row.choice + (p !== undefined ? ` ${percent(p)}` : "");
  } else if (row?.type === "noul") {
    // The walk compares yes with the state's threshold, so which way it went
    // comes from the transition, not from 50%.
    said = (said === "true" ? "yes" : said === "false" ? "no" : (said ?? "answered")) + ` (yes ${percent(row.yes)})`;
  }
  return `${said ?? "answered"} → ${d.next}`;
}
