// A Start that is safe to retry (RFC EE item 5; loomcycle 1.109, gap G24).
//
// A detached start answers with the walk's run id, and that answer is the only
// handle on the walk. If it is lost — a proxy timeout, a dropped connection —
// the walk is running and the canvas does not know. Pressing Start again would
// run the team twice.
//
// So every start carries an idempotency key, and a RETRY of the same start
// carries the same one: the runtime then answers with the walk it already
// started instead of starting another. "The same start" is the same version
// with the same input and variables; change any of them and it is a new
// start, with a new key. The runtime does not compare request bodies, so
// reusing a key across different inputs would hand back the wrong walk.
//
// Pure: no React, no network.

export interface StartAttempt {
  key: string;
  /** What was started: the version, the input and the variables. */
  print: string;
}

/** A stable description of what a start starts. */
export function startPrint(target: { defId?: string; input?: string; vars?: Record<string, string> }): string {
  const vars = Object.entries(target.vars ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([target.defId ?? "", target.input ?? "", vars]);
}

/** The attempt for this press of Start: the unfinished one when it is a retry
 *  of the same start, otherwise a new one. `pending` is the last attempt that
 *  did not come back with a walk; pass undefined once one has. */
export function startAttempt(pending: StartAttempt | undefined, print: string, newKey: () => string): StartAttempt {
  return pending && pending.print === print ? pending : { key: newKey(), print };
}

/** A key the runtime accepts: 1 to 200 characters of `[A-Za-z0-9:._-]`. */
export function newStartKey(): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `loomboard-start:${id}`;
}
