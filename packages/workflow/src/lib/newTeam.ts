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

// How the RUNTIME reads a key. loomcycle parses a definition with Go's
// encoding/json, which matches an object key to a field by Unicode simple
// case folding: "Hooks", "HOOKS" and "hookſ" are all `hooks` to it. The
// summary below must read keys the same way, or a definition could carry a
// section past it under another spelling.
const fold = (k: string) => k.toUpperCase().toLowerCase();

/** Every value of `o` whose key the runtime reads as `name`. */
function valuesOf(o: JsonObject, name: string): unknown[] {
  return Object.keys(o)
    .filter((k) => fold(k) === name)
    .map((k) => o[k]);
}

/** Text from the import, shown back: bounded, so a name cannot bury the rest. */
const show = (s: unknown) => {
  const t = String(s);
  return t.length > 64 ? `${t.slice(0, 64)}…` : t;
};

/** Present with content: not absent, null, `{}` or `[]`. */
function hasContent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
}

/** Objects holding two keys the runtime may read as ONE — `agent` beside
 *  `Agent`. The canvas draws one of them; the runtime may run the other. */
function sameKeyTwice(x: unknown, path: string, out: string[]) {
  if (Array.isArray(x)) x.forEach((e, i) => sameKeyTwice(e, `${path}[${i}]`, out));
  else if (isObj(x)) {
    const seen = new Map<string, string>();
    for (const k of Object.keys(x)) {
      const f = fold(k);
      const first = seen.get(f);
      if (first !== undefined) {
        out.push(
          `${JSON.stringify(show(first))} and ${JSON.stringify(show(k))} ${path ? `in ${show(path)} ` : ""}` +
            "may be one key to loomcycle: what it runs may not be what the canvas shows",
        );
      } else seen.set(f, k);
      sameKeyTwice(x[k], path ? `${path}.${k}` : k, out);
    }
  }
}

interface HookTally {
  /** A hooks section with content was found. */
  present: boolean;
  total: number;
  inline: number;
}

/** Count a hooks value loosely — every list element at any depth — so an
 *  unexpected shape is still counted rather than read as "no hooks". */
function tallyHooks(v: unknown, into: HookTally) {
  if (!hasContent(v)) return;
  into.present = true;
  const visit = (x: unknown) => {
    if (Array.isArray(x)) {
      for (const e of x) {
        if (Array.isArray(e)) visit(e);
        else {
          into.total++;
          if (isObj(e)) into.inline++;
        }
      }
    } else if (isObj(x)) for (const k of Object.keys(x)) visit(x[k]);
  };
  visit(v);
}

/** Every hooks / tool_hooks section anywhere inside `x`, under any spelling. */
function tallyHooksWithin(x: unknown, into: HookTally) {
  if (Array.isArray(x)) for (const e of x) tallyHooksWithin(e, into);
  else if (isObj(x)) {
    for (const k of Object.keys(x)) {
      const f = fold(k);
      if (f === "hooks" || f === "tool_hooks") tallyHooks(x[k], into);
      else tallyHooksWithin(x[k], into);
    }
  }
}

function hookText(t: HookTally): string {
  // Counts only: an inline webhook's URL and headers can carry a token.
  if (!t.total) return "present, in a form this summary cannot count";
  return `${t.total} ${t.total === 1 ? "hook" : "hooks"}` + (t.inline ? `, ${t.inline} calling a URL written in the definition` : "");
}

const LOCAL_LABELS: Record<string, string> = {
  agents: "own agents",
  skills: "own skills",
  channels: "own channels",
  schedules: "own schedules",
  webhooks: "own webhooks",
};

/** What the graph draws or the canvas shows as it is: nothing to list. */
const DRAWN = new Set(["entry", "states", "transitions", "vars", "layout", "colors", "max_iterations"]);
const LISTED = new Set(["hooks", "local", "channels"]);

/** What an imported definition carries that the GRAPH does not draw, and that
 *  a save would store under the operator's own authority: hooks, the team's
 *  own definitions, channel grants. An import is someone else's text; the
 *  operator is shown this before it replaces the draft. Names and counts
 *  only — never a hook's URL or headers.
 *
 *  It errs towards listing: keys are read as the runtime reads them (`fold`),
 *  and a top-level key the canvas does not know is listed rather than assumed
 *  to mean nothing. */
export function importNotes(def: JsonObject): string[] {
  const spelling: string[] = [];
  const unknown: string[] = [];
  for (const k of Object.keys(def)) {
    const f = fold(k);
    if (!DRAWN.has(f) && !LISTED.has(f)) unknown.push(`A key the canvas does not know: ${show(k)}`);
    else if (k !== f) spelling.push(`${JSON.stringify(show(k))} is read by loomcycle as ${f}`);
  }

  const twice: string[] = [];
  sameKeyTwice(def, "", twice);
  // A few say it; a definition built to flood the list should not.
  const out: string[] = [...spelling, ...twice.slice(0, 5)];

  const walk: HookTally = { present: false, total: 0, inline: 0 };
  for (const v of valuesOf(def, "hooks")) tallyHooks(v, walk);
  if (walk.present) out.push(`Walk hooks: ${hookText(walk)}`);

  const hooked: string[] = [];
  const inStates: HookTally = { present: false, total: 0, inline: 0 };
  for (const states of valuesOf(def, "states")) {
    if (!Array.isArray(states)) continue;
    states.forEach((st, i) => {
      const t: HookTally = { present: false, total: 0, inline: 0 };
      tallyHooksWithin(st, t);
      if (!t.present) return;
      const name = isObj(st) ? valuesOf(st, "state").find((n) => typeof n === "string" && n) : undefined;
      hooked.push(name !== undefined ? show(name) : `#${i + 1}`);
      inStates.present = true;
      inStates.total += t.total;
      inStates.inline += t.inline;
    });
  }
  if (inStates.present) out.push(`Hooks on ${hooked.length === 1 ? "state" : "states"} ${hooked.join(", ")}: ${hookText(inStates)}`);

  for (const local of valuesOf(def, "local")) {
    if (!isObj(local)) {
      if (hasContent(local)) out.push("The team's own definitions: present, in a form this summary cannot read");
      continue;
    }
    for (const k of Object.keys(local)) {
      const entries = local[k];
      if (!hasContent(entries)) continue;
      const kind = fold(k);
      const label = LOCAL_LABELS[kind] ?? `own ${show(k)}`;
      if (!isObj(entries)) {
        out.push(`The team's ${label}: present, in a form this summary cannot read`);
        continue;
      }
      const names = Object.keys(entries);
      const open =
        kind === "webhooks"
          ? names.filter((n) => {
              const e = entries[n];
              if (!isObj(e)) return false;
              return valuesOf(e, "auth").some((a) => isObj(a) && valuesOf(a, "kind").some((x) => String(x).toLowerCase() === "none"));
            })
          : [];
      out.push(`The team's ${label}: ${names.map(show).join(", ")}` + (open.length ? ` (no authentication: ${open.map(show).join(", ")})` : ""));
    }
  }

  for (const acl of valuesOf(def, "channels")) {
    if (!isObj(acl)) {
      if (hasContent(acl)) out.push("Channel grants: present, in a form this summary cannot read");
      continue;
    }
    for (const k of Object.keys(acl)) {
      const list = acl[k];
      if (!hasContent(list)) continue;
      const side = fold(k);
      const what = side === "publish" ? "Channels it may publish to" : side === "subscribe" ? "Channels it may read" : `Channel grants (${show(k)})`;
      out.push(`${what}: ${Array.isArray(list) ? list.map(show).join(", ") : "present, in a form this summary cannot read"}`);
    }
  }

  return [...out, ...unknown];
}

/** The file a team downloads as. */
export function exportFileName(name: string | null): string {
  return `${name || "team"}.json`;
}
