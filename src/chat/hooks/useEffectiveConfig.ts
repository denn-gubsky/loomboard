import { useCallback, useEffect, useState } from "react";
import type { EffectiveConfigResponse, LoomcycleClient } from "@loomcycle/client";

// Reads what the LIVE run will actually use, field by field, with the layer that
// decided each (loomcycle `GET /v1/runs/{id}/effective-config`).
//
// ONLY A LIVE RUN HAS ONE. The endpoint is gated on the run being in the steer
// registry, so a chat with no run yet and a chat whose run has finished both
// 404 — deliberately, since that is also what a cross-tenant run returns and the
// gate must not become an existence oracle. A 404 is therefore NOT an error
// here: it means "nothing to report", and the panel falls back to the agent's
// declared definition. Only an unexpected failure is worth a console line.
//
// Refetched when the run changes and when `revision` moves — the caller bumps
// that after anything that can change the run's configuration (a turn, a
// retune), because the report is a snapshot and nothing pushes updates.

export function useEffectiveConfig(
  client: LoomcycleClient,
  runId: string | null,
  revision: number,
): EffectiveConfigResponse | null {
  const [report, setReport] = useState<EffectiveConfigResponse | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!runId) {
        setReport(null);
        return;
      }
      try {
        const r = await client.getEffectiveConfig(runId, { signal });
        if (!signal.aborted) setReport(r);
      } catch (e) {
        if (signal.aborted) return;
        // A run that is no longer steerable answers 404; that is the common
        // case, not a fault. Clear rather than keep a stale report.
        setReport(null);
        if (!isNotFound(e)) console.warn("[effective-config] read failed", e);
      }
    },
    [client, runId],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load, revision]);

  return report;
}

function isNotFound(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return status === 404 || (e as { name?: string } | null)?.name === "NotFoundError";
}
