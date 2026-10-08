// Building a team by hand (RFC DX phase 4): what a new team starts from, what
// it may be called, and reading a definition someone pasted or uploaded.
//
// Pure: no React, no network.

import type { JsonObject } from "./model";
import { parseDefinition, type TextPosition } from "./teamJson";

export interface TeamTemplate {
  id: string;
  label: string;
  /** What the template gives, in a few words. */
  hint: string;
  definition: JsonObject;
}

/** What a new team starts from. `empty` has no entry: the first state placed
 *  becomes it. */
export const TEAM_TEMPLATES: readonly TeamTemplate[] = [
  { id: "empty", label: "Empty", hint: "no states yet", definition: { states: [], transitions: [] } },
  {
    id: "one-agent",
    label: "One agent",
    hint: "an agent, then End",
    definition: {
      entry: "work",
      states: [
        { state: "work", handler: { kind: "agent", agent: "" } },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "work", to: "done", on: "success" }],
    },
  },
];

// teamgraph.ValidateName: one segment, so a team's name can prefix its own
// agents as <team>/<name>.
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Why a NEW team cannot be called `name`, or undefined. `taken` is the names
 *  the runtime already has: a create under one of them would not be refused —
 *  it would become that team's next active version. */
export function teamNameError(name: string, taken: readonly string[]): string | undefined {
  if (!name) return "a team needs a name";
  if (!NAME_RE.test(name)) return "a name is one segment of A-Z a-z 0-9 _ -, at most 64 characters";
  if (taken.includes(name)) return `a team named ${JSON.stringify(name)} already exists`;
  return undefined;
}

export type ImportResult =
  | { ok: true; def: JsonObject }
  | { ok: false; message: string; position?: TextPosition };

function isObj(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The definition in `text`. A stored version as the runtime returns it
 *  (`{def_id, name, definition: {…}}`) is unwrapped, since that is what a
 *  person copies out of the TeamDef tool. The text is parsed, never run. */
export function importDefinition(text: string): ImportResult {
  if (!text.trim()) return { ok: false, message: "nothing to import" };
  const parsed = parseDefinition(text);
  if (!parsed.ok) return { ok: false, message: parsed.message, position: parsed.position };
  const def = !("states" in parsed.def) && isObj(parsed.def.definition) ? parsed.def.definition : parsed.def;
  if (!Array.isArray(def.states)) {
    return { ok: false, message: "this is not a team definition: it has no `states` list" };
  }
  return { ok: true, def };
}

/** The file a team downloads as. */
export function exportFileName(name: string | null): string {
  return `${name || "team"}.json`;
}
