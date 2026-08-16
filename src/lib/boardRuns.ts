import type { RunTile } from "./runStates";

// Group the run-state tiles by the board task (chunk) they carry, so the
// workflow board can pin live agent miniatures to their cards. By default only
// LIVE (running) runs are kept — a finished handler run isn't "working" the card
// anymore, and useUserRunStates retains terminal tiles, which would otherwise
// pile up on the card.

export function runsByChunk(
  tiles: RunTile[],
  opts: { liveOnly?: boolean } = {},
): Map<string, RunTile[]> {
  const liveOnly = opts.liveOnly ?? true;
  const m = new Map<string, RunTile[]>();
  for (const t of tiles) {
    if (!t.boardChunkId) continue;
    if (liveOnly && t.status !== "running") continue;
    const arr = m.get(t.boardChunkId);
    if (arr) arr.push(t);
    else m.set(t.boardChunkId, [t]);
  }
  return m;
}
