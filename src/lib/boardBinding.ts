// The board↔team binding is a loomboard convention — loomcycle ships no
// Document↔TeamDef binding, so the bound TeamDef name lives in the board
// Document's ROOT-CHUNK `fields.team` (the same fields blob P1 saved views use).
// Pure over a chunk's `fields`; the async get_chunk / update_chunk live in the
// data layer.

export interface BoardConfig {
  /** The bound TeamDef name — its graph supplies the columns + transitions. */
  team?: string;
}

/** Read the board config from a root chunk's `fields`. */
export function readBoardConfig(fields: unknown): BoardConfig {
  if (!fields || typeof fields !== "object") return {};
  const f = fields as Record<string, unknown>;
  const cfg: BoardConfig = {};
  if (typeof f.team === "string" && f.team) cfg.team = f.team;
  return cfg;
}

/** Merge a team pointer into a chunk's existing `fields` (undefined clears it),
 *  preserving any other fields the chunk carries. */
export function withBoardTeam(
  fields: unknown,
  team: string | undefined,
): Record<string, unknown> {
  const base =
    fields && typeof fields === "object"
      ? { ...(fields as Record<string, unknown>) }
      : {};
  if (team) base.team = team;
  else delete base.team;
  return base;
}
