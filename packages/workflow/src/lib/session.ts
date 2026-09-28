// The canvas session machine: which mode the surface is in, and what that
// makes possible. RFC CZ decision C5.
//
// WHY a pure reducer rather than a handful of booleans in the component: the
// rules are interlocking — the graph is read-only exactly when a walk is live,
// Debug is a state you can enter from Run mid-walk, Stopped is not a fourth
// mode but a phase of the other two, and returning to Edit is explicit because
// it DISCARDS the trace. Booleans drift out of agreement; a reducer cannot.
//
// The invariant worth naming: **Edit is unreachable while a walk is live.** A
// walk executes one pinned def_id, so editing the definition underneath it
// produces a canvas that no longer describes what is running.
//
// Pure: no React, no network, no SDK.

export type SessionMode = "edit" | "run" | "debug";

/** Where the walk itself is. `idle` = none started; `ended` = finished,
 *  aborted or capped, with the trace still on screen to read. */
export type WalkPhase = "idle" | "running" | "parked" | "ended";

/** `unknown` is a walk the canvas tried to stop and the runtime reported as no
 *  longer in flight: it ended, but nothing on this surface saw how. */
export type EndStatus = "completed" | "aborted" | "failed" | "capped" | "unknown";

export interface SessionState {
  mode: SessionMode;
  phase: WalkPhase;
  /** The detached walk's run id — the handle every live surface addresses.
   *  Absent until a run starts, because a synchronous walk never had one. */
  runId?: string;
  ended?: { status: EndStatus; detail?: string };
  /** Canonical armed set, as the server echoes it back. */
  armed: string[];
}

export const INITIAL: SessionState = { mode: "edit", phase: "idle", armed: [] };

export type SessionEvent =
  | { t: "start"; runId: string; debug: boolean }
  | { t: "parked" }
  | { t: "released" }
  | { t: "ended"; status: EndStatus; detail?: string }
  | { t: "armed"; armed: string[] }
  | { t: "toEdit" };

/** True while the walk is in flight — running, or parked at a breakpoint. */
export function isLive(s: SessionState): boolean {
  return s.phase === "running" || s.phase === "parked";
}

export function reduce(s: SessionState, e: SessionEvent): SessionState {
  switch (e.t) {
    case "start":
      // Starting is only meaningful when nothing is in flight. Ignoring the
      // event rather than throwing keeps a double-click from corrupting state.
      if (isLive(s)) return s;
      return {
        mode: e.debug ? "debug" : "run",
        phase: "running",
        runId: e.runId,
        armed: s.armed,
      };

    case "parked":
      if (s.phase !== "running") return s;
      // Reaching a pause means a breakpoint was armed, so the surface IS a
      // debugger now whether or not it was started as one — this is the ad-hoc
      // Run → Debug transition arriving from the server rather than the UI.
      return { ...s, mode: "debug", phase: "parked" };

    case "released":
      if (s.phase !== "parked") return s;
      return { ...s, phase: "running" };

    case "ended":
      if (!isLive(s)) return s;
      // Mode is deliberately preserved: the trace stays on screen in the mode
      // it was produced in, because the most useful moment to read a failed
      // wave is right after it fails.
      return { ...s, phase: "ended", ended: { status: e.status, detail: e.detail } };

    case "armed": {
      const armed = [...e.armed].sort();
      if (s.phase === "parked") return { ...s, armed };
      // Arming promotes Run → Debug; clearing the whole set demotes back, but
      // never while parked — a parked walk still needs the step controls to
      // release it, and disarming is what releases it.
      const mode: SessionMode = armed.length ? "debug" : s.mode === "debug" ? "run" : s.mode;
      return { ...s, mode: s.phase === "idle" ? s.mode : mode, armed };
    }

    case "toEdit":
      // THE invariant. A live walk cannot be edited out from under itself, so
      // this is a no-op rather than a forced stop — the operator must end the
      // walk first, deliberately.
      if (isLive(s)) return s;
      return { ...INITIAL, armed: [] };
  }
}

/** Whether the graph itself accepts edits. */
export function canEditGraph(s: SessionState): boolean {
  return s.mode === "edit" && !isLive(s);
}

/** Whether "back to Edit" should be offered. It discards the trace, so it is
 *  never automatic — see the C5 note on leaving Stopped. */
export function canReturnToEdit(s: SessionState): boolean {
  return s.mode !== "edit" && !isLive(s);
}

/** Whether a run can be started right now. */
export function canStart(s: SessionState): boolean {
  return !isLive(s);
}

export type Availability = { available: true } | { available: false; reason: string };

/** Whether this walk can be ABORTED, and if not, why not (RFC CZ C16).
 *
 *  A live walk — running OR parked at a breakpoint — is stopped by cancelling
 *  its run: loomcycle #1341 registers the walk's context by run id, so
 *  `POST /v1/runs/{run_id}/cancel` ends the walk and every run it spawned.
 *  Before #1341 that route 409'd for a walk and abort worked only through a
 *  pause's own `abort` answer; the one cancel covers both phases now.
 *
 *  `hostCanCancel` is whether the host wired the cancel at all. Without it the
 *  button is still shown, disabled with this reason, because "why can I not
 *  stop this" is the question an operator will actually have. */
export function abortAvailability(s: SessionState, hostCanCancel: boolean): Availability {
  if (!isLive(s)) return { available: false, reason: "No walk is running." };
  if (!hostCanCancel) {
    return {
      available: false,
      reason: "This host provides no way to stop a walk. Let it finish, or stop it from the runtime.",
    };
  }
  return { available: true };
}

/** A one-line description of where the session is, for the toolbar. */
export function statusLabel(s: SessionState): string {
  if (s.phase === "running") return s.mode === "debug" ? "Debugging" : "Running";
  if (s.phase === "parked") return "Paused at a breakpoint";
  if (s.phase === "ended") {
    const st = s.ended?.status ?? "completed";
    if (st === "completed") return "Finished";
    if (st === "capped") return "Hit the iteration cap";
    if (st === "unknown") return "Ended (outcome not reported)";
    return `Run ${st}`;
  }
  return "Editing";
}
