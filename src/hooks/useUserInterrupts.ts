import { useEffect, useState } from "react";
import type { InterruptRow, LoomcycleClient } from "@loomcycle/client";

// Which runs have a pending agent Question, polled cheaply in ONE request
// (listUserInterrupts) rather than a per-run stream. Drives the tile's question
// badge. Keyed by run_id (the newest pending interrupt per run wins).
export function useUserInterrupts(
  client: LoomcycleClient,
  userId: string | null | undefined,
  intervalMs = 5000,
): Map<string, InterruptRow> {
  const [byRun, setByRun] = useState<Map<string, InterruptRow>>(new Map());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const ac = new AbortController();

    const poll = async () => {
      try {
        const res = await client.listUserInterrupts(userId, {
          status: "pending",
          signal: ac.signal,
        });
        if (cancelled) return;
        const m = new Map<string, InterruptRow>();
        for (const r of res.interrupts) {
          const cur = m.get(r.run_id);
          // Keep the most recently created pending interrupt per run.
          if (!cur || r.created_at > cur.created_at) m.set(r.run_id, r);
        }
        setByRun(m);
      } catch (e) {
        if (!cancelled) console.warn("[board] interrupts poll failed:", e);
      }
    };

    void poll();
    const id = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      ac.abort();
      clearInterval(id);
    };
  }, [client, userId, intervalMs]);

  return byRun;
}
