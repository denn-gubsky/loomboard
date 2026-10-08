// What a save sends (RFC DX): the draft, made safe to send as a FORK.
//
// A save is a fork whose overlay is the whole draft, and loomcycle merges a
// fork per top-level key (teamdef.go applyTeamOverlay): a key the overlay
// omits — or sends as null — KEEPS the parent's value. So a section the draft
// no longer has would silently survive the save. `forkOverlay` adds an
// explicit clear (`{}`) for each section the parent has and the draft dropped,
// which is the only spelling the runtime reads as "none":
//
//   colors, layout, channels, hooks, vars   wholesale, `{}` declares none
//   local.<kind>                             per kind, wholesale within one
//
// It compares against the PARENT the fork merges over — the active version
// at save time — not against what was loaded: after one save in a session,
// the loaded definition is no longer the parent.
//
// `max_iterations` is a scalar, cleared by a SENT 0 (loomcycle ≥ 1.105.0;
// an older runtime ignores the 0 and keeps the parent's cap).
//
// Pure: no React, no network.

import type { Json, JsonObject } from "./model";

/** Top-level sections a fork replaces wholesale, cleared by `{}`. */
const WHOLESALE = ["colors", "layout", "channels", "hooks", "vars"] as const;
const LOCAL_KINDS = ["agents", "skills", "channels", "schedules", "webhooks"] as const;

function obj(v: Json | undefined): JsonObject | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : undefined;
}

/** Present with a value: absent and null both mean "keep the parent's". */
function present(v: Json | undefined): boolean {
  return v !== undefined && v !== null;
}

/** The draft with an explicit clear for every section — and the iteration
 *  cap — `parent` has and the draft dropped. The draft itself is not modified. */
export function forkOverlay(parent: JsonObject, draft: JsonObject): JsonObject {
  const out: JsonObject = { ...draft };
  for (const key of WHOLESALE) {
    if (present(parent[key]) && !present(draft[key])) out[key] = {};
  }
  const cap = parent.max_iterations;
  if (typeof cap === "number" && cap !== 0 && draft.max_iterations === undefined) out.max_iterations = 0;
  const had = obj(parent.local);
  if (had) {
    const kinds = LOCAL_KINDS.filter((k) => present(had[k]));
    const local = obj(draft.local);
    const missing = kinds.filter((k) => !local || !present(local[k]));
    if (missing.length) {
      out.local = { ...(local ?? {}) };
      for (const k of missing) (out.local as JsonObject)[k] = {};
    }
  }
  return out;
}
