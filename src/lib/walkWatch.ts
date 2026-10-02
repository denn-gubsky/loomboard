import type { LoomcycleClient } from "@loomcycle/client";
import type { WalkRunRow } from "@loomboard/workflow";
import { belongsToWalk, rowFromAgent, rowFromEvent } from "./walkRows";

// Follow one team walk (RFC CZ M3): the host half of WorkflowDataLayer.watchWalk.
//
// Hydrate, then stream — the same shape as the board's useUserRunStates:
//   1. listWalkRuns(walkId), every page — the walk's run and every member it
//      started, including any that finished before this tab looked;
//   2. streamUserRunStates(self, { walkId }) — their transitions from now on.
// The server caps the stream at ~30 minutes, so on a clean end (or an error)
// it reconnects and HYDRATES AGAIN, which picks up anything missed in the gap.
// foldWalk on the canvas side is order-tolerant, so a page that lands after a
// newer stream frame cannot roll a run back.
//
// It stops on its own once the walk's run is terminal and a final listing has
// been folded: an ended walk starts nothing more, so a stream after that would
// only hold a connection open.
//
// The walk's OWN run is on the filtered stream (loomcycle #1587, gap G10): its
// start, its end, and a breakpoint pause as awaited_state "interrupted". So
// nothing is polled — an older runtime that filtered the walk's own run out
// would leave the end to the next re-hydration.

const RECONNECT_MS = 2000;
const TERMINAL = new Set(["completed", "failed", "cancelled", "rejected"]);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

export interface WatchTiming {
  reconnectMs?: number;
}

export function watchWalk(
  client: LoomcycleClient,
  selfUserId: () => Promise<string>,
  walkRunId: string,
  onRows: (rows: WalkRunRow[]) => void,
  onError?: (e: unknown) => void,
  timing: WatchTiming = {},
): () => void {
  const reconnectMs = timing.reconnectMs ?? RECONNECT_MS;
  const ac = new AbortController();
  const { signal } = ac;

  // Returns true when the listing shows the walk ended.
  const hydrate = async (): Promise<boolean> => {
    let cursor = "";
    let ended = false;
    do {
      const page = await client.listWalkRuns(walkRunId, { cursor: cursor || undefined, signal });
      const rows = page.agents.map(rowFromAgent);
      if (rows.length) onRows(rows);
      ended ||= rows.some((r) => r.runId === walkRunId && TERMINAL.has(r.status));
      cursor = page.next_cursor;
    } while (cursor && !signal.aborted);
    return ended;
  };

  // The walk has ended: fold one last listing — so every member's final state
  // lands even if its own frame was lost — and stop everything.
  let finishing = false;
  const finish = async () => {
    if (finishing) return;
    finishing = true;
    try {
      await hydrate();
    } catch (e) {
      if (!signal.aborted) onError?.(e);
    }
    ac.abort();
  };

  void (async () => {
    const userId = await selfUserId().catch((e) => {
      onError?.(e);
      return undefined;
    });
    if (!userId) return;

    while (!signal.aborted) {
      try {
        if (await hydrate()) return void (await finish());
        for await (const item of client.streamUserRunStates(userId, { walkId: walkRunId, signal })) {
          if (signal.aborted) return;
          if (item.kind !== "event" || !belongsToWalk(item.payload, walkRunId)) continue;
          onRows([rowFromEvent(item.payload)]);
          // The walk's own end: fold a last listing and stop.
          if (item.payload.run_id === walkRunId && TERMINAL.has(item.payload.status)) {
            return void (await finish());
          }
        }
        // Clean end (the server's stream cap) → reconnect and re-hydrate.
      } catch (e) {
        if (signal.aborted) return;
        onError?.(e);
      }
      await sleep(reconnectMs, signal);
    }
  })();

  return () => ac.abort();
}
