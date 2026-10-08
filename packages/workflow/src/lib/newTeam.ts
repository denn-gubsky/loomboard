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

const LOCAL_LABELS: readonly (readonly [string, string])[] = [
  ["agents", "own agents"],
  ["skills", "own skills"],
  ["channels", "own channels"],
  ["schedules", "own schedules"],
  ["webhooks", "own webhooks"],
];

function hookCount(v: unknown): { total: number; inline: number } {
  let total = 0;
  let inline = 0;
  const visit = (x: unknown) => {
    if (Array.isArray(x)) {
      for (const e of x) {
        total++;
        if (isObj(e)) inline++;
      }
    } else if (isObj(x)) for (const k of Object.keys(x)) visit(x[k]);
  };
  visit(v);
  return { total, inline };
}

function hookNote(where: string, v: unknown): string | undefined {
  const { total, inline } = hookCount(isObj(v) ? v : {});
  if (!total) return undefined;
  // Counts only: an inline webhook's URL and headers can carry a token.
  return `${where}: ${total} ${total === 1 ? "hook" : "hooks"}` + (inline ? `, ${inline} calling a URL written in the definition` : "");
}

/** What an imported definition carries that the GRAPH does not draw, and that
 *  a save would store under the operator's own authority: hooks, the team's
 *  own definitions, channel grants. An import is someone else's text; the
 *  operator is shown this before it replaces the draft. Names and counts
 *  only — never a hook's URL or headers. */
export function importNotes(def: JsonObject): string[] {
  const out: string[] = [];
  const walk = hookNote("Walk hooks", def.hooks);
  if (walk) out.push(walk);
  const hooked: string[] = [];
  let stateHooks = { total: 0, inline: 0 };
  for (const st of Array.isArray(def.states) ? def.states : []) {
    if (!isObj(st) || !isObj(st.handler)) continue;
    // Each is a map of event → entries.
    const a = hookCount(isObj(st.handler.hooks) ? st.handler.hooks : {});
    const b = hookCount(isObj(st.handler.tool_hooks) ? st.handler.tool_hooks : {});
    if (!a.total && !b.total) continue;
    hooked.push(String(st.state));
    stateHooks = { total: stateHooks.total + a.total + b.total, inline: stateHooks.inline + a.inline + b.inline };
  }
  if (hooked.length) {
    out.push(
      `Hooks on ${hooked.length === 1 ? "state" : "states"} ${hooked.join(", ")}: ${stateHooks.total}` +
        (stateHooks.inline ? `, ${stateHooks.inline} calling a URL written in the definition` : ""),
    );
  }
  const local = isObj(def.local) ? def.local : {};
  for (const [kind, label] of LOCAL_LABELS) {
    const entries = local[kind];
    if (!isObj(entries)) continue;
    const names = Object.keys(entries);
    if (!names.length) continue;
    const open =
      kind === "webhooks"
        ? names.filter((n) => {
            const e = entries[n];
            return isObj(e) && isObj(e.auth) && e.auth.kind === "none";
          })
        : [];
    out.push(`The team's ${label}: ${names.join(", ")}` + (open.length ? ` (no authentication: ${open.join(", ")})` : ""));
  }
  const acl = isObj(def.channels) ? def.channels : {};
  for (const side of ["publish", "subscribe"] as const) {
    const list = acl[side];
    if (Array.isArray(list) && list.length) out.push(`Channels it may ${side === "publish" ? "publish to" : "read"}: ${list.map(String).join(", ")}`);
  }
  return out;
}

/** The file a team downloads as. */
export function exportFileName(name: string | null): string {
  return `${name || "team"}.json`;
}
