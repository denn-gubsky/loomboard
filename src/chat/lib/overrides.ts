import type { ContinueOptions, RunOptions } from "@loomcycle/client";
import type { ConversationOverrides } from "../types";

// The RFC DC override half of a run's options.
//
// DERIVED from the exported RunOptions rather than imported: loomcycle declares
// `RunOverrideOptions` in its types but does not re-export it from the package
// entry, so it is unreachable by name from a consumer (checked at 1.82.0). Since
// RunOptions extends it, picking the twelve names off RunOptions gets the same
// types — and does it better, because the Pick stops compiling the day upstream
// renames one, which a hand-written copy of the interface would not.
type RunOverrideOptions = Pick<
  RunOptions,
  | "model"
  | "provider"
  | "tier"
  | "effort"
  | "maxTokens"
  | "maxIterations"
  | "unboundedIterations"
  | "maxConcurrentChildren"
  | "retryAttempts"
  | "memoryInjectMaxTokens"
  | "memoryIndexMaxBytes"
  | "injectToolGuide"
>;
export type { RunOverrideOptions };

// Maps a conversation's sparse snake_case overlay onto the client's camelCase
// per-run options (RFC DC). Pure → unit-tested.
//
// TWO LIFETIMES, and the split is the point. The RETUNABLE keys are the ones
// loomcycle will accept against a run that is ALREADY going; the START-ONLY ones
// are fixed when a run begins and are simply not in the retune vocabulary, so
// sending them to that endpoint is a 422. Keeping them in separate tables is
// what lets the panel say which is which instead of the UI guessing.
//
// PRESENCE, NEVER TRUTHINESS. An absent key means "inherit the agent"; a key
// present with a zero value is a real setting — loomcycle stores several of
// these as pointers precisely so `retry_attempts: 0` and `inject_tool_guide:
// false` can be expressed. `""` is the one value that still means inherit: the
// editor emits it for a cleared text box. This mirrors the gate in loomcycle's
// own applyOverridesToWire, which tests `!== undefined` for the same reason.
//
// VALUE-SHAPE-AGNOSTIC ON PURPOSE. Values are copied through untouched rather
// than coerced per type, because `interruption` is an OBJECT — loomcycle had to
// hand-write its own isZero over exactly that. Writing it this way cost nothing
// and meant adopting the field was one row in the table rather than a rewrite.
//
// `interactive` is deliberately NOT here even though 1.83.0 accepts it per-run.
// It is not an AgentDef field — parking at a turn boundary is a property of a
// RUN — so no field registry describes it, and a loomboard chat already starts
// interactive, which would make the control a no-op. It belongs on the surfaces
// that show somebody else's live run, where promoting one is a real action.

/** snake_case overlay key → the client's camelCase option name.
 *
 *  Typed as plain strings, not `keyof RunOverrideOptions`: that type widens to
 *  `string | number | symbol` because the client's options carry an index
 *  signature, which defeats the check it looks like it is making. The names are
 *  guarded by the parity test instead. */
const RETUNABLE: Readonly<Record<string, string>> = {
  model: "model",
  provider: "provider",
  tier: "tier",
  effort: "effort",
  max_tokens: "maxTokens",
  max_iterations: "maxIterations",
  unbounded_iterations: "unboundedIterations",
  max_concurrent_children: "maxConcurrentChildren",
  retry_attempts: "retryAttempts",
  memory_inject_max_tokens: "memoryInjectMaxTokens",
  memory_index_max_bytes: "memoryIndexMaxBytes",
  inject_tool_guide: "injectToolGuide",
  // The first OBJECT-valued override ({enabled, kinds, max_pending}), and the
  // reason this mapper copies values through untouched instead of coercing per
  // type. It is also what lets a chat ask questions on an agent whose own
  // definition does not enable them — the one capability the deleted AgentDef
  // fork had that per-run overrides could not express until 1.83.0.
  interruption: "interruption",
};

type StartOnlyKey = "sampling" | "compaction" | "maxContextTokens" | "runTimeoutSeconds";

/** Fixed at run start. Present on both RunOptions and ContinueOptions, absent
 *  from the retune vocabulary. */
const START_ONLY: Readonly<Record<string, StartOnlyKey>> = {
  sampling: "sampling",
  compaction: "compaction",
  max_context_tokens: "maxContextTokens",
  run_timeout_seconds: "runTimeoutSeconds",
};

export const RETUNABLE_KEYS: readonly string[] = Object.keys(RETUNABLE);
export const START_ONLY_KEYS: readonly string[] = Object.keys(START_ONLY);

/** Whether a key carries a real setting. Absent, undefined and "" all mean
 *  inherit; 0 and false do not. */
function isSet(v: unknown): boolean {
  return v !== undefined && v !== "";
}

/** The overlay stores nested keys the way the YAML does — `top_p`,
 *  `keep_last_n` — because agentDefRegistry mirrors the definition shape. Most
 *  of the client's option objects are the camelCase twin of that, and their
 *  serialisers read ONLY camelCase: samplingToWire looks for `topP` and ignores
 *  `top_p` entirely. A key whose name happens to coincide (`temperature`,
 *  `enabled`, `mode`) survives; every other one is dropped without a word.
 *
 *  That is the same failure this whole area is about — a setting that looks
 *  applied and is not — so the conversion is done here rather than trusted to
 *  coincidence. */
function snakeToCamelKeys(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = val;
  }
  return out;
}

/** Nested overrides whose client type is snake_case already, so converting them
 *  would break what works. `interruption` declares `max_pending` verbatim
 *  (checked at 1.84.0) because it is passed to the wire untouched rather than
 *  through a *ToWire serialiser. */
const WIRE_SHAPED = new Set(["interruption", "state_schema"]);

function project(
  ov: ConversationOverrides,
  table: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [snake, camel] of Object.entries(table)) {
    if (!(snake in ov) || !isSet(ov[snake])) continue;
    out[camel] = WIRE_SHAPED.has(snake) ? ov[snake] : snakeToCamelKeys(ov[snake]);
  }
  return out;
}

/** The overlay's retunable half, as client options. */
export function toRunOverrides(ov: ConversationOverrides): RunOverrideOptions {
  return project(ov, RETUNABLE) as RunOverrideOptions;
}

/** The overlay's start-only half. Valid on runStreaming and continueSession;
 *  never on a retune. */
export function toStartOnlyOptions(
  ov: ConversationOverrides,
): Pick<RunOptions & ContinueOptions, StartOnlyKey> {
  return project(ov, START_ONLY) as Pick<RunOptions & ContinueOptions, StartOnlyKey>;
}

/** Whether the overlay sets anything the runtime would act on. */
export function hasOverrides(ov: ConversationOverrides): boolean {
  return Object.keys(toRunOverrides(ov)).length > 0 ||
    Object.keys(toStartOnlyOptions(ov)).length > 0;
}

/** What moved between two overlays, for a retune.
 *
 *  `cleared` is reported SEPARATELY because the wire has no clear verb: a retune
 *  MERGES, writing only the keys it names, so a key the user cleared cannot be
 *  un-set on a live run at all. A caller seeing a non-empty `cleared` has to
 *  start a fresh run rather than pretend the clear took. */
export function retunePayload(
  prev: ConversationOverrides,
  next: ConversationOverrides,
): { set: RunOverrideOptions; cleared: string[] } {
  const a = toRunOverrides(prev) as Record<string, unknown>;
  const b = toRunOverrides(next) as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (!(k in a) || a[k] !== v) set[k] = v;
  }
  const cleared = Object.keys(a).filter((k) => !(k in b));
  return { set: set as RunOverrideOptions, cleared };
}
