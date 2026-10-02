// The Run as the canvas's data source (RFC CZ C13, M3).
//
// A walk is a run, and every run it starts carries `parent_context.walk_id`
// (= the walk's run id), the `state` that started it and that state's `visit`
// (loomcycle 1.101, gap G3). One listing (listWalkRuns) and one filtered
// stream (streamUserRunStates({ walkId })) therefore describe the whole walk.
// The host maps both onto WalkRunRow and hands them here; this module folds
// them into what the canvas draws.
//
// NOT a cache of run content: rows carry status and identity only. A run's
// prompt and result are read from the run when asked for (getRun /
// getRunPrompt), so a reload, a second tab and a second operator see the same
// thing (C6, "wave data comes from the run join").
//
// Pure: no React, no SDK.

/** One run, as the canvas needs it. The host maps an SDK `Agent` (listing) or
 *  `RunStateEvent` (stream) onto this — the package depends on no SDK. */
export interface WalkRunRow {
  runId: string;
  agentId: string;
  agent: string;
  /** running | completed | failed | cancelled | rejected | configured | … */
  status: string;
  /** RFC3339 of this state; the newer row wins. */
  ts: string;
  /** Members only: the state that started this run, and the WALK's ordinal of
   *  that state visit (1 = the first state the walk ran) — not a per-state
   *  count; visitNumbers turns it into one. */
  state?: string;
  stateVisit?: number;
  /** Starter members only. */
  waveId?: string;
  waveIndex?: number;
  /** What a running run is blocked on (loomcycle 1.101, gap G1). */
  awaited?: "channel" | "interrupted" | "review" | "input";
  /** The channel, interruption kind, or the agent_stop hook holding a review. */
  awaitedOn?: string;
  /** When an unruled review hold ends as rejected. */
  holdExpiresAt?: string;
  error?: string;
  stopReason?: string;
}

export interface WalkView {
  walkRunId: string;
  /** The walk's own run, once seen. */
  walk?: WalkRunRow;
  /** Every member run, by run id. */
  members: ReadonlyMap<string, WalkRunRow>;
}

export function emptyWalk(walkRunId: string): WalkView {
  return { walkRunId, members: new Map() };
}

/** Terminal statuses. A held run is still `running` with awaited=review. */
const TERMINAL = new Set(["completed", "failed", "cancelled", "rejected"]);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

// A row's instant as epoch milliseconds, for comparing rows from the two
// sources. They are compared as TIMES, never as strings: the listing writes
// the server's local offset with microseconds ("…12:37:14.827396+03:00"), the
// stream UTC whole seconds ("…09:37:48Z"), so as strings a listing row on any
// server east of UTC looks newer and rolls every streamed transition back.
//
// The fraction is cut (or padded) to exactly three digits first, so the input
// is the ECMAScript date-time format every engine must parse — Go trims
// trailing zeros, and accepting longer fractions is an engine extension the
// Tauri webview need not share. Microseconds beyond the millisecond are
// therefore ignored: two rows in the same millisecond tie. An unparseable
// instant sorts as the oldest.
export function instantMs(ts: string): number {
  const millis = ts.replace(
    /(T\d{2}:\d{2}:\d{2})\.(\d+)/,
    (_, hms: string, frac: string) => `${hms}.${frac.padEnd(3, "0").slice(0, 3)}`,
  );
  const ms = Date.parse(millis);
  return Number.isNaN(ms) ? -Infinity : ms;
}

/** Fold rows into the view. A row replaces the one it has only when it is
 *  NOT older: the stream can deliver a transition before the hydration page
 *  that predates it, and the page must not roll the run back. Equal
 *  instants take the newcomer, whatever their spelling (as do two unparseable
 *  ones) — and a terminal row is never replaced by a non-terminal one,
 *  because a run does not come back from completed. */
export function foldWalk(view: WalkView, rows: readonly WalkRunRow[]): WalkView {
  let walk = view.walk;
  let members: Map<string, WalkRunRow> | undefined;
  const newer = (prev: WalkRunRow | undefined, next: WalkRunRow) => {
    if (!prev) return true;
    if (isTerminal(prev.status) && !isTerminal(next.status)) return false;
    return instantMs(next.ts) >= instantMs(prev.ts);
  };
  for (const r of rows) {
    if (r.runId === view.walkRunId) {
      if (newer(walk, r)) walk = r;
      continue;
    }
    const cur = (members ?? view.members).get(r.runId);
    if (!newer(cur, r)) continue;
    members ??= new Map(view.members);
    members.set(r.runId, cur ? withIdentity(r, cur) : r);
  }
  if (walk === view.walk && !members) return view;
  return { ...view, walk, members: members ?? view.members };
}

/** The newer row is authoritative for everything that CHANGES — status, and
 *  above all `awaited`: a hold that has cleared is reported by the field's
 *  ABSENCE, so merging "defined fields only" would keep a stale hold forever.
 *  Only the run's place in the graph, which never changes, is carried over
 *  when a frame omits it — and a review hold's deadline while the run is
 *  STILL held: only the stream carries holdExpiresAt, so a heartbeat listing
 *  landing mid-hold would otherwise drop it. Once the hold clears, so does
 *  the deadline. */
function withIdentity(next: WalkRunRow, prev: WalkRunRow): WalkRunRow {
  return {
    ...next,
    state: next.state ?? prev.state,
    stateVisit: next.stateVisit ?? prev.stateVisit,
    waveId: next.waveId ?? prev.waveId,
    waveIndex: next.waveIndex ?? prev.waveIndex,
    holdExpiresAt:
      next.holdExpiresAt ??
      (next.awaited === "review" && prev.awaited === "review" ? prev.holdExpiresAt : undefined),
  };
}

/** A row's lifecycle, as the canvas words it. */
export type RowPhase = "running" | "held" | "waiting" | "completed" | "failed" | "cancelled" | "rejected";

export function rowPhase(r: WalkRunRow): RowPhase {
  if (r.status === "completed" || r.status === "failed" || r.status === "cancelled" || r.status === "rejected") {
    return r.status;
  }
  if (r.awaited === "review") return "held";
  if (r.awaited) return "waiting";
  return "running";
}

export interface StatePulse {
  total: number;
  running: number;
  held: number;
  waiting: number;
  completed: number;
  failed: number;
  rejected: number;
  cancelled: number;
}

const ZERO: StatePulse = {
  total: 0,
  running: 0,
  held: 0,
  waiting: 0,
  completed: 0,
  failed: 0,
  rejected: 0,
  cancelled: 0,
};

/** Every state's run counts, keyed by state id. */
export function statePulses(view: WalkView): Map<string, StatePulse> {
  const out = new Map<string, StatePulse>();
  for (const r of view.members.values()) {
    if (!r.state) continue;
    const p = { ...(out.get(r.state) ?? ZERO) };
    p.total++;
    p[rowPhase(r)]++;
    out.set(r.state, p);
  }
  return out;
}

/** The one-line face for a state, e.g. "3/8 done · 1 held · 4 running".
 *  Empty when the state has started nothing yet. */
export function pulseLabel(p?: StatePulse): string {
  if (!p || !p.total) return "";
  const parts = [`${p.completed}/${p.total} done`];
  if (p.held) parts.push(`${p.held} held`);
  if (p.waiting) parts.push(`${p.waiting} waiting`);
  if (p.running) parts.push(`${p.running} running`);
  if (p.failed) parts.push(`${p.failed} failed`);
  if (p.rejected) parts.push(`${p.rejected} rejected`);
  if (p.cancelled) parts.push(`${p.cancelled} cancelled`);
  return parts.join(" · ");
}

/** A state's runs in the order they happened: visit, then wave position. */
export function rowsForState(view: WalkView, state: string): WalkRunRow[] {
  return [...view.members.values()]
    .filter((r) => r.state === state)
    .sort(
      (a, b) =>
        (a.stateVisit ?? 0) - (b.stateVisit ?? 0) ||
        (a.waveIndex ?? 0) - (b.waveIndex ?? 0) ||
        instantMs(a.ts) - instantMs(b.ts),
    );
}

/** The state the walk ran LAST — its most recent member, by instant (never
 *  by spelling: the listing and the stream write different offsets, see
 *  instantMs). Undefined before any member ran. */
export function lastState(view: WalkView): string | undefined {
  let last: WalkRunRow | undefined;
  for (const r of view.members.values()) {
    if (r.state && (!last || instantMs(r.ts) >= instantMs(last.ts))) last = r;
  }
  return last?.state;
}

/** Each row's visit number WITHIN its state: the rank of its walk ordinal
 *  among the distinct ordinals in `rows` (one state's rows). The runtime's
 *  state_visit counts the walk's visits across all states, so a state the walk
 *  reaches second carries 2 on its first visit. Rows without one are absent. */
export function visitNumbers(rows: readonly WalkRunRow[]): Map<string, number> {
  const ordinals = [...new Set(rows.flatMap((r) => (r.stateVisit ? [r.stateVisit] : [])))].sort((a, b) => a - b);
  const out = new Map<string, number>();
  for (const r of rows) if (r.stateVisit) out.set(r.runId, ordinals.indexOf(r.stateVisit) + 1);
  return out;
}

/** What the walk's OWN run says about the session (C5 machine events):
 *  - `ended` once the walk run is terminal;
 *  - `parked` while it waits on an Interruption — the before_dispatch pause
 *    is the walk asking an operator (CY Decision 4 amended);
 *  - `released` when that wait clears;
 *  - nothing otherwise. */
export type WalkSignal =
  | { t: "ended"; status: "completed" | "failed" | "aborted"; detail?: string }
  | { t: "parked" }
  | { t: "released" }
  | null;

export function walkSignal(prev: WalkRunRow | undefined, next: WalkRunRow | undefined): WalkSignal {
  if (!next || prev === next) return null;
  if (isTerminal(next.status)) {
    const status = next.status === "completed" ? "completed" : next.status === "cancelled" ? "aborted" : "failed";
    return { t: "ended", status, detail: next.error ?? next.stopReason ?? undefined };
  }
  const was = prev?.awaited === "interrupted";
  const is = next.awaited === "interrupted";
  if (is && !was) return { t: "parked" };
  if (was && !is) return { t: "released" };
  return null;
}
