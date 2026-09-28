// Mirror of loomcycle's hook-attachment checks (RFC DK), as a TeamDef carries
// them: `hooks` on the walk and `hooks` / `tool_hooks` on a state that starts
// runs. Sources, at v1.99.0:
//
//   internal/hooks/entry.go      Entry (un)marshal, EventHooks.Validate,
//                                ToolHooks.Validate, Entry.validate, ParseRef
//   internal/hooks/def.go        isRunPhase, ValidateDefName, phaseList
//   internal/hooks/types.go      the Phase constants, IsToolPhase, FailMode
//   internal/teamgraph/validate.go  validateHooks — which kinds may carry them
//
// JSON DECODING IS PART OF THE RULE SET. Go refuses some shapes while
// unmarshalling, before Validate ever runs: an entry that is neither a string
// nor an object, an inline webhook with an unknown key or a mistyped field, an
// event list that is not an array. The runtime answers all of those with a
// refusal, so they are findings here too, phrased as the decode error.
//
// Pure: no React, no SDK. Returns messages, the caller anchors them.

import type { JsonObject } from "./model";

/** Every event a team or an agent may attach. `channel_publish` is a
 *  channel's own and is refused on a team, with its own message. */
export const TOOL_PHASES = ["pre", "post", "post_failure"] as const;
export const RUN_PHASES = [
  "agent_start",
  "agent_stop",
  "subagent_start",
  "subagent_stop",
  "pre_compact",
  "post_compact",
  "run_end",
] as const;
export const CHANNEL_PHASE = "channel_publish";

/** Verbatim from hooks/def.go, so the message names the same list. */
const PHASE_LIST =
  "pre, post, post_failure, agent_start, agent_stop, subagent_start, subagent_stop, pre_compact, post_compact, run_end";

/** The handler kinds that start runs, and so may carry hooks. */
export const HOOK_BEARING_KINDS = ["agent", "parallel", "consolidator", "starter"] as const;

const RESERVED_HEADERS = new Set([
  "host",
  "content-type",
  "content-length",
  "accept",
  "transfer-encoding",
  "connection",
]);

/** Go's strconv.Atoi range on the 64-bit builds loomcycle ships. */
const INT64_MAX = 9223372036854775807n;

const INLINE_KEYS = new Set(["name", "url", "fail_mode", "timeout_ms", "headers"]);

function isObj(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isToolPhase = (p: string) => (TOOL_PHASES as readonly string[]).includes(p);
const isRunPhase = (p: string) => (RUN_PHASES as readonly string[]).includes(p);

/** Go's sort order over the map's keys — byte order, which is what `<` on Go
 *  strings is. Only affects WHICH error the runtime reports first. */
function sortedKeys(o: JsonObject): string[] {
  return Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Mirrors hooks.ValidateDefName. Length is in BYTES and is checked before the
 *  characters, as Go does. */
export function validateDefName(name: string): string | null {
  if (name === "") return "name is required";
  const bytes = new TextEncoder().encode(name).length;
  if (bytes > 128) return `name is ${bytes} bytes; the limit is 128`;
  for (const seg of name.split("/")) {
    if (seg === "") {
      return `name ${JSON.stringify(name)} has an empty segment (no leading, trailing or double slash)`;
    }
    for (const r of seg) {
      if (!/^[A-Za-z0-9_-]$/.test(r)) {
        return (
          `name ${JSON.stringify(name)} has invalid character ${JSON.stringify(r)} ` +
          "(allowed: A-Z a-z 0-9 _ - and / between segments)"
        );
      }
    }
  }
  return null;
}

/** Mirrors hooks.ParseRef: the LAST `@` splits name from version, and the
 *  version is read by strconv.Atoi — which takes an optional sign and leading
 *  zeros ("+3", "03") but no spaces, and fails past int64. */
export function parseRef(ref: string): string | null {
  let name = ref;
  const at = ref.lastIndexOf("@");
  if (at >= 0) {
    name = ref.slice(0, at);
    const v = ref.slice(at + 1);
    const ok = /^[+-]?[0-9]+$/.test(v) && BigInt(v) <= INT64_MAX && BigInt(v) >= 1n;
    if (!ok) return `hook ${JSON.stringify(ref)}: the version after @ must be a positive number`;
  }
  const nameErr = validateDefName(name);
  return nameErr ? `hook ${JSON.stringify(ref)}: ${nameErr}` : null;
}

/** Decode + validate one inline webhook object (Entry.UnmarshalJSON with
 *  DisallowUnknownFields, then Entry.validate). */
function validateInline(in_: JsonObject): string | null {
  const decode = (why: string) =>
    `a hook is a HookDef name or an inline webhook {name, url, fail_mode, timeout_ms}: ${why}`;
  for (const k of Object.keys(in_)) {
    if (!INLINE_KEYS.has(k)) return decode(`json: unknown field ${JSON.stringify(k)}`);
  }
  // JSON null leaves a Go field at its zero value, so it is accepted here too.
  const strField = (k: string) => in_[k] === undefined || in_[k] === null || typeof in_[k] === "string";
  for (const k of ["name", "url", "fail_mode"]) {
    if (!strField(k)) return decode(`field ${k} must be a string`);
  }
  const t = in_.timeout_ms;
  if (t !== undefined && t !== null && !(typeof t === "number" && Number.isInteger(t))) {
    return decode("field timeout_ms must be an integer");
  }
  const h = in_.headers;
  if (h !== undefined && h !== null) {
    if (!isObj(h) || Object.values(h).some((v) => typeof v !== "string" && v !== null)) {
      return decode("field headers must map names to strings");
    }
  }

  const name = typeof in_.name === "string" ? in_.name : "";
  const url = typeof in_.url === "string" ? in_.url : "";
  const failMode = typeof in_.fail_mode === "string" ? in_.fail_mode : "";
  const nameErr = validateDefName(name);
  if (nameErr) return `inline webhook: ${nameErr}`;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `inline webhook ${name}: url must be http:// or https://`;
  }
  if (failMode !== "" && failMode !== "open" && failMode !== "closed") {
    return `inline webhook ${name}: fail_mode must be "open" or "closed"`;
  }
  if (typeof t === "number" && t < 0) return `inline webhook ${name}: timeout_ms must be ≥ 0`;
  if (isObj(h)) {
    // Go iterates a map in random order, so which bad header it names first is
    // not stable either; any one of them is a refusal.
    for (const [k, v] of Object.entries(h)) {
      const err = headerError(k, typeof v === "string" ? v : "");
      if (err) return `inline webhook ${name}: ${err}`;
    }
  }
  return null;
}

function headerError(k: string, v: string): string | null {
  if (k === "") return "a header name is required";
  if (!/^[A-Za-z0-9_-]+$/.test(k)) return `header ${JSON.stringify(k)}: a name is letters, digits, - and _`;
  if (RESERVED_HEADERS.has(k.toLowerCase())) return `header ${JSON.stringify(k)} is set by the call itself`;
  if (/[\r\n]/.test(v)) return `header ${JSON.stringify(k)}: a value cannot contain a line break`;
  return null;
}

/** One entry: a reference string, or an inline webhook object. `null` decodes
 *  to an empty inline webhook in Go, which then fails on its missing name. */
function validateEntry(e: unknown): string | null {
  if (typeof e === "string") return parseRef(e);
  if (e === null) return "inline webhook: name is required";
  if (isObj(e)) return validateInline(e);
  return "a hook is a HookDef name or an inline webhook {name, url, fail_mode, timeout_ms}: wrong JSON type";
}

/** Mirrors EventHooks.Validate(tool). `tool` is "" for a state's or the
 *  walk's own hooks. Returns the FIRST error, as Go does — one finding per
 *  bad map, not a cascade. */
export function validateEventHooks(v: unknown, tool = ""): string | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) return "hooks must map events to lists of hooks";
  for (const phase of sortedKeys(v)) {
    if (isToolPhase(phase)) {
      // an agent-level tool event applies to every tool: allowed
    } else if (isRunPhase(phase)) {
      if (tool !== "") {
        return `tool ${tool}: ${phase} is a run event; attach it under the agent's hooks, not a tool's`;
      }
    } else if (phase === CHANNEL_PHASE) {
      return `hooks: ${phase} is a channel's event; attach it under the channel's hooks`;
    } else {
      return `hooks: unknown event ${JSON.stringify(phase)} (one of ${PHASE_LIST})`;
    }
    const list = v[phase];
    if (list === null) continue;
    if (!Array.isArray(list)) return `hooks.${phase} must be a list of hooks`;
    for (const entry of list) {
      const err = validateEntry(entry);
      if (err) return `hooks.${phase}: ${err}`;
    }
  }
  return null;
}

/** Mirrors ToolHooks.Validate. */
export function validateToolHooks(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) return "tool_hooks must map tool names to their hooks";
  for (const name of sortedKeys(v)) {
    if (name.trim() === "") return "tool hooks: a tool name is required";
    const err = validateEventHooks(v[name], name);
    if (err) return err;
  }
  return null;
}

/** True when a hooks map carries anything — Go's `len(h.Hooks) == 0` test,
 *  which counts keys, not entries: `{"agent_stop": []}` is non-empty. */
export function hasHooks(v: unknown): boolean {
  return isObj(v) && Object.keys(v).length > 0;
}

/** Mirrors the walk half of teamgraph.validateHooks: the walk only ENDS, so
 *  only `run_end` fires for it. */
export function validateWalkHooks(v: unknown): string | null {
  if (isObj(v)) {
    for (const event of sortedKeys(v)) {
      if (event !== "run_end") {
        return `hooks: the walk only ends, so only run_end fires for it (got ${event})`;
      }
    }
  }
  const err = validateEventHooks(v);
  return err ? `hooks: ${err}` : null;
}

/** Mirrors the state half of teamgraph.validateHooks. Returns messages to be
 *  prefixed with the state, like validateHandler's. */
export function validateStateHooks(kind: string, handler: JsonObject): string[] {
  const { hooks, tool_hooks: toolHooks } = handler;
  if (!hasHooks(hooks) && !hasHooks(toolHooks)) {
    // Absent, empty — or the wrong JSON type, which Go refuses while decoding.
    if (hooks !== undefined && hooks !== null && !isObj(hooks)) {
      return ["hooks must map events to lists of hooks"];
    }
    if (toolHooks !== undefined && toolHooks !== null && !isObj(toolHooks)) {
      return ["tool_hooks must map tool names to their hooks"];
    }
    return [];
  }
  if (!(HOOK_BEARING_KINDS as readonly string[]).includes(kind)) {
    return [`(${kind}) starts no run, so it cannot carry hooks`];
  }
  const out: string[] = [];
  const e = validateEventHooks(hooks);
  if (e) out.push(e);
  const t = validateToolHooks(toolHooks);
  if (t) out.push(t);
  return out;
}
