import { useEffect, useRef, useState } from "react";
import type { WalkRunRow } from "./lib/runs";
import type { RunLine, WorkflowDataLayer } from "./types";

// Run mode's live lines: one subscription per run that is going right now
// (the latest live run of each state), opened when it appears and closed when
// it settles — a finished run is no longer "active", so its lines go with it.
//
// Keyed by run id, so a state that moves on to its next run (a pushback, a
// second wave) switches to that run's conversation.

export function useRunLines(
  watch: WorkflowDataLayer["watchRunLines"],
  live: ReadonlyMap<string, WalkRunRow>,
): Map<string, RunLine[]> {
  const [byRun, setByRun] = useState<ReadonlyMap<string, RunLine[]>>(new Map());
  const subs = useRef(new Map<string, () => void>());
  const key = [...live.values()].map((r) => r.runId).sort().join(",");

  useEffect(() => {
    if (!watch) return;
    const want = new Set(key ? key.split(",") : []);
    for (const [runId, stop] of subs.current) {
      if (want.has(runId)) continue;
      stop();
      subs.current.delete(runId);
      setByRun((m) => {
        if (!m.has(runId)) return m;
        const next = new Map(m);
        next.delete(runId);
        return next;
      });
    }
    for (const runId of want) {
      if (subs.current.has(runId)) continue;
      subs.current.set(
        runId,
        watch(
          runId,
          (lines) => setByRun((m) => new Map(m).set(runId, lines)),
          (e) => console.warn(`[canvas] following run ${runId} failed:`, e),
        ),
      );
    }
  }, [watch, key]);

  // Close everything on unmount (Back to Edit drops the walk).
  useEffect(
    () => () => {
      for (const stop of subs.current.values()) stop();
      subs.current.clear();
    },
    [],
  );

  const out = new Map<string, RunLine[]>();
  for (const [state, r] of live) {
    const lines = byRun.get(r.runId);
    if (lines?.length) out.set(state, lines);
  }
  return out;
}
