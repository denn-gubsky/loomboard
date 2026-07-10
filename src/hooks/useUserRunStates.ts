import { useEffect, useMemo, useState } from "react";
import type { LoomcycleClient } from "@loomcycle/client";
import {
  applyRunStateEvent,
  tileFromAgent,
  type RunTile,
} from "../lib/runStates";

// One aggregate SSE (streamUserRunStates) drives the whole board: coarse per-run
// status transitions for every run under the principal. We hydrate the initial
// set with listUserAgents (the only source of session_id), then fold transitions.
// The server caps the stream at ~30 min, so we reconnect (re-hydrating each time
// to catch anything missed during the gap). This is the scalable path — NOT one
// blocking per-run stream per tile.

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export interface UserRunStates {
  /** Newest transition first. */
  tiles: RunTile[];
  connected: boolean;
}

export function useUserRunStates(
  client: LoomcycleClient,
  userId: string | null | undefined,
): UserRunStates {
  const [tiles, setTiles] = useState<Map<string, RunTile>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const ac = new AbortController();

    void (async () => {
      while (!cancelled) {
        try {
          // (Re)hydrate on each connect so a reconnect resyncs missed changes.
          // Upsert (don't replace) so tiles the stream already knows survive and
          // applyRunStateEvent's preserved session_id isn't dropped.
          const agents = await client.listUserAgents(userId, { signal: ac.signal });
          if (cancelled) return;
          setTiles((prev) => {
            const next = new Map(prev);
            for (const a of agents) next.set(a.run_id, tileFromAgent(a));
            return next;
          });

          for await (const item of client.streamUserRunStates(userId, { signal: ac.signal })) {
            if (cancelled) return;
            if (item.kind === "open") setConnected(true);
            else if (item.kind === "event") {
              setTiles((prev) => applyRunStateEvent(prev, item.payload));
            }
          }
          // Clean end (30-min cap) → loop reconnects.
        } catch (e) {
          if (cancelled) return;
          console.warn("[board] run-state stream error (reconnecting):", e);
        }
        setConnected(false);
        if (!cancelled) await sleep(2000, ac.signal);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [client, userId]);

  // Newest transition first — a stable, useful default order for the board.
  const list = useMemo(
    () => [...tiles.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)),
    [tiles],
  );

  return { tiles: list, connected };
}
