// The TeamDef handler's field registry, in @loomcycle/def-fields' shape.
//
// WHY reuse def-fields rather than hand-rolling controls: the loomcycle
// Library already edits AgentDef parameters through FoldedFieldList, and a
// canvas inspector that looks and behaves differently for no reason is a
// second thing to learn. Grouping, per-field hints, search and the
// modified-only filter all come free.
//
// ONE SEMANTIC MISMATCH, stated because it is not obvious: def-fields is built
// for a SPARSE OVERLAY, where an absent key means "inherit from the parent def
// or operator yaml". A TeamDef handler is not an overlay — an absent `agent`
// on an `agent` handler does not inherit anything, it is simply invalid, and
// the validation mirror says so immediately. The rendering is still right; only
// the meaning of "unset" differs, which `unsetMeans` carries per field.
//
// SCOPE: P0 covers the fields the runtime READS today. `input_template` is
// declared in teamgraph.Handler but read nowhere until RFC CY L1 lands, so
// showing an editor for it would invite an operator to set something with no
// effect. It is deliberately absent — and the passthrough model means an
// existing value survives untouched regardless. It joins this registry in P2,
// alongside `system_prompt`.

import type { DefRegistry, FieldSpec } from "@loomcycle/def-fields";

/** Handler kinds P0 renders. Mirrors model.KNOWN_KINDS; kept as a literal here
 *  because def-fields wants a readonly string[] for an enum's options. */
const KIND_OPTIONS = ["agent", "parallel", "consolidator", "terminal"] as const;

const FIELDS: readonly FieldSpec[] = [
  {
    key: "kind",
    label: "Kind",
    group: "Handler",
    type: "enum",
    options: KIND_OPTIONS,
    hint:
      "What this state does when the walk enters it. agent runs one; parallel fans out; " +
      "consolidator judges the previous output and picks the outgoing edge; terminal ends the walk.",
    unsetMeans: "invalid — every state needs a kind",
  },

  {
    key: "agent",
    label: "Agent",
    group: "Agents",
    type: "text",
    placeholder: "reviewer",
    hint: "The AgentDef this state runs. Required for kind=agent and kind=consolidator.",
    unsetMeans: "required for agent / consolidator",
  },
  {
    key: "agents",
    label: "Agents (parallel)",
    group: "Agents",
    type: "string-list",
    placeholder: "agent name…",
    hint: "The AgentDefs a parallel state fans out to, run concurrently. Required for kind=parallel.",
    unsetMeans: "required for parallel",
  },
  {
    key: "consolidator",
    label: "Consolidator",
    group: "Agents",
    type: "text",
    placeholder: "judge",
    hint:
      "An agent that reads the results and names the outgoing edge on a `signal:` line. " +
      "Required after a parallel fan-out; optional on a single agent, where it enables pushback.",
    unsetMeans: "a single-agent state advances on success",
  },

  {
    key: "wait",
    label: "Wait",
    group: "Execution",
    type: "text",
    placeholder: "all | any | at_least:2",
    hint:
      "How many of a parallel state's agents must succeed before it continues. " +
      "all waits for every one; any takes the first; at_least:N takes N.",
    unsetMeans: "all — every agent must succeed",
  },
  {
    key: "timeout_ms",
    label: "Timeout (ms)",
    group: "Execution",
    type: "int",
    min: 0,
    hint: "Wall-clock budget for this state's handler.",
    unsetMeans: "no per-state timeout",
    advanced: true,
  },
];

export const teamHandlerRegistry: DefRegistry = {
  kind: "teamhandler",
  groups: [
    { name: "Handler" },
    { name: "Agents", hint: "Which AgentDefs this state runs." },
    {
      name: "Execution",
      hint: "How the state's run is bounded. Unset means the substrate default applies.",
    },
  ],
  fields: FIELDS,
};

/** Handler keys the canvas renders OUTSIDE the folded list, so the inspector
 *  can omit them without dropping them from the registry — the registry stays
 *  the complete description of the primitive (def-fields' `omitKeys` contract). */
export const HANDLER_OMIT_IN_LIST: readonly string[] = ["kind"];

/** Which registry fields are meaningful for a given kind. def-fields has no
 *  conditional-field concept, so the inspector filters with this rather than
 *  showing `agents` on a terminal state. */
export function fieldsForKind(kind: string): string[] {
  switch (kind) {
    case "agent":
      return ["agent", "consolidator", "timeout_ms"];
    case "consolidator":
      return ["agent", "timeout_ms"];
    case "parallel":
      return ["agents", "consolidator", "wait", "timeout_ms"];
    case "terminal":
      return [];
    default:
      // An unknown kind is edited by nobody here — the opaque node's fields
      // are preserved verbatim and belong to a runtime this build predates.
      return [];
  }
}
