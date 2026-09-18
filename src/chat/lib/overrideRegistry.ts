import { agentDefRegistry, type DefRegistry, type FieldSpec } from "@loomcycle/def-fields";
import type { EffectiveValue, LibraryAgentDefinition } from "@loomcycle/client";
import { RETUNABLE_KEYS, START_ONLY_KEYS } from "./overrides";
import { describeEffective, placeholderFor } from "./effective";

// The field registry behind the chat's overrides panel: the RFC DC vocabulary,
// borrowed from @loomcycle/def-fields' agentDefRegistry rather than redeclared.
//
// Borrowed, because that registry is generated against loomcycle's own AgentDef
// and carries a drift test on the Go source. Redeclaring sixteen fields here
// would put a second, unguarded copy of the same truth in a second repo. We only
// SELECT from it and re-group.
//
// Regrouping is the point of this module. agentDefRegistry files these by
// subject — max_tokens and max_context_tokens are both "Limits" — but the panel
// has to sort them by LIFETIME instead: one of those two can be changed on the
// conversation you are looking at and the other cannot. Grouping by subject here
// would quietly imply the four Limits fields behave alike.

export const THIS_CHAT = "This chat";
export const NEXT_RUN = "Next run only";

/** The six retunable keys the Library's agent report actually carries, so an
 *  unset field can name the value it would inherit instead of describing it. */
const REPORTED = [
  "provider",
  "model",
  "tier",
  "effort",
  "max_tokens",
  "max_iterations",
] as const;

function inheritedValue(
  baseDef: LibraryAgentDefinition | undefined,
  key: string,
): string | undefined {
  if (!baseDef || !(REPORTED as readonly string[]).includes(key)) return undefined;
  const v = (baseDef as unknown as Record<string, unknown>)[key];
  if (v === undefined || v === null || v === "") return undefined;
  return String(v);
}

/** Build the panel's registry.
 *
 *  Two optional sources of "what is in force", in descending order of truth:
 *
 *  `effective` is loomcycle's per-field report for the LIVE run — the value and
 *  the layer that decided it, for every field. It is the real answer, and the
 *  only one that can distinguish a deliberate setting from a default nobody
 *  chose. It exists only while a run does.
 *
 *  `baseDef` is the agent's declared definition — a sparse overlay, so it speaks
 *  for the handful of fields that agent happens to set. It is what a chat with
 *  no run yet has, and it is absent entirely for a delegated user token, which
 *  cannot read the agent library. Each field falls back to the registry's own
 *  prose, which still beats a bare "inherit". */
export function buildOverrideRegistry(
  baseDef?: LibraryAgentDefinition,
  effective: Readonly<Record<string, EffectiveValue>> = {},
): DefRegistry {
  const byKey = new Map(agentDefRegistry.fields.map((f) => [f.key, f]));

  const take = (key: string, group: string, extraHint?: string): FieldSpec | null => {
    const base = byKey.get(key);
    // A key that no longer resolves is DROPPED rather than faked: def-fields is
    // 0.x, and a field missing from the panel is a far better failure than a
    // control bound to a key the runtime will not read. The drift test turns
    // this into a red build instead of a silent gap.
    if (!base) return null;

    // The hint is the only slot def-fields renders for EVERY field in BOTH
    // states — `unsetMeans` is a tooltip and `placeholder` is ignored by the
    // bool, enum and object controls. So the value in force goes here, where it
    // is actually read.
    const inForce = describeEffective(effective[key]);
    const declared = inheritedValue(baseDef, key);
    const preview = placeholderFor(effective[key]) ?? declared;

    const hint = [base.hint, extraHint, inForce].filter(Boolean).join(" ");
    return {
      ...base,
      group,
      hint,
      ...(preview ? { placeholder: preview } : {}),
      ...(declared ? { unsetMeans: `the agent's own: ${declared}` } : {}),
    };
  };

  const fields = [
    ...RETUNABLE_KEYS.map((k) => take(k, THIS_CHAT, ROUTING_NOTES[k])),
    ...START_ONLY_KEYS.map((k) =>
      take(
        k,
        NEXT_RUN,
        "Fixed when a run starts, so it reaches this chat's next new run — not the one already in progress.",
      ),
    ),
  ].filter((f): f is FieldSpec => f !== null);

  return {
    kind: agentDefRegistry.kind,
    groups: [
      {
        name: THIS_CHAT,
        hint: "Applied to this conversation's run. A change takes effect on your next message.",
      },
      {
        name: NEXT_RUN,
        hint: "Fixed at run start. These cannot reach a run that is already going.",
      },
    ],
    fields,
  };
}

// Server-side authority rules that are NOT obvious from a field on its own, and
// which we deliberately do not enforce client-side: the authority is loomcycle's
// and a copy here would drift. Saying them is the useful half.
const ROUTING_NOTES: Record<string, string | undefined> = {
  model: "Naming a model PINS it: the tier stops choosing and stops falling back.",
  provider: "Narrows the tier's choice to one vendor; it still picks the model and still falls back.",
  max_concurrent_children: "May only be LOWERED below what the agent allows.",
};
