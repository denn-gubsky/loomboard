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

import { AGENT_HOOK_EVENTS, type DefRegistry, type FieldSpec } from "@loomcycle/def-fields";

/** Handler kinds this build renders. Mirrors model.KNOWN_KINDS; kept as a
 *  literal here because def-fields wants a readonly string[] for an enum's
 *  options. registry.test.ts asserts the two lists stay equal. */
const KIND_OPTIONS = [
  "agent",
  "parallel",
  "consolidator",
  "terminal",
  "starter",
  "channel",
  "vars",
  "input",
  "decision",
] as const;

const FIELDS: readonly FieldSpec[] = [
  {
    key: "kind",
    label: "Kind",
    group: "Handler",
    type: "enum",
    options: KIND_OPTIONS,
    hint:
      "What this node does when the walk enters it. agent runs one; parallel fans out; " +
      "consolidator judges the previous output and picks the outgoing edge; decision asks a decision " +
      "model typed questions and routes on an answer; terminal ends the walk.",
    unsetMeans: "invalid — every node needs a kind",
  },

  {
    key: "agent",
    label: "Agent",
    group: "Agents",
    type: "text",
    placeholder: "reviewer",
    hint: "The AgentDef this node runs. Required for kind=agent and kind=consolidator.",
    unsetMeans: "required for agent / consolidator",
  },
  {
    key: "agents",
    label: "Agents (parallel)",
    group: "Agents",
    type: "string-list",
    placeholder: "agent name…",
    hint: "The AgentDefs a parallel node fans out to, run concurrently. Required for kind=parallel.",
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
    unsetMeans: "a single-agent node advances on success",
  },

  {
    key: "wait",
    label: "Wait",
    group: "Execution",
    type: "text",
    placeholder: "all | any | at_least:2",
    hint:
      "How many of a parallel node's agents must succeed before it continues. " +
      "all waits for every one; any takes the first; at_least:N takes N.",
    unsetMeans: "all — every agent must succeed",
  },
  {
    key: "timeout_ms",
    label: "Timeout (ms)",
    group: "Execution",
    type: "int",
    min: 0,
    hint: "Wall-clock budget for this node's handler.",
    unsetMeans: "no per-node timeout",
    advanced: true,
  },

  // ---- per-node prompts (RFC CY L1) ----
  //
  // The reason a fan-out of N reviewers is ONE AgentDef and N states rather
  // than N cloned defs: the node says what the agent is DOING here, the
  // AgentDef says what it IS. Cloning per role would also lose prompt caching,
  // because the agent's base prompt is sent with cache_control and N nodes
  // sharing one agent still hit one cached prefix.
  {
    key: "system_prompt",
    label: "System prompt",
    group: "Prompt",
    type: "textarea",
    hint:
      "This node's role, APPENDED to the agent's own system prompt as a second segment " +
      "rather than replacing it. Editing it forks the definition — it rides States, which " +
      "the content hash covers.",
    unsetMeans: "the agent's own system prompt alone",
  },
  {
    key: "input_template",
    label: "Input template",
    group: "Prompt",
    type: "textarea",
    hint:
      "This node's user prompt. When set it REPLACES the input threaded from the previous " +
      "node; leave it unset to pass that input through.",
    unsetMeans: "the previous node's output is threaded through",
  },

  // ---- vars and input (RFC CY L2) ----
  {
    key: "set",
    label: "Set",
    group: "Variables",
    type: "kv",
    hint:
      "Variable name → a value that may itself contain ${…} tokens, resolved when the node " +
      "runs. This is the ONE place a workflow assigns a variable, and it is its own node kind " +
      "so the assignment is visible on the canvas rather than hidden on something that looks " +
      "like an agent. Names match [a-zA-Z0-9_-]{1,64}.",
    unsetMeans: "required on a vars node",
  },
  {
    key: "schema",
    label: "JSON Schema",
    group: "Form",
    type: "json",
    hint:
      "The schema a client renders as this workflow's start form. The runtime does not " +
      "interpret it — it rides the definition so a team is self-describing and a headless " +
      "caller sees the same contract the canvas does.",
    unsetMeans: "the run takes a plain text input",
  },

  // ---- the decision state (loomcycle 1.109, RFC ED) ----
  //
  // It asks a decision model typed questions about `about`, binds the answers
  // through `capture`, and takes the transition its routed question's answer
  // selects. It starts no agent run.
  {
    key: "about",
    label: "About",
    group: "Decision",
    type: "json",
    hint:
      "The JSON object the questions are about — all the model reads. A string value may use " +
      "${var.*}, ${now.*}, ${team.*} and {{thread.output}} (what the previous node handed over); " +
      "no other {{…}} placeholder.",
    unsetMeans: "required on a decision node",
  },
  {
    key: "questions",
    label: "Questions",
    group: "Decision",
    type: "json",
    hint:
      "Name → question. A choice has criteria {option: description or null}; a noul (yes/no) has " +
      "optional criteria describing \"true\" and \"false\"; a score has criteria as a list of level " +
      "descriptions, lowest first. Every question needs instructions.",
    unsetMeans: "required on a decision node — at least one question",
  },
  {
    key: "route",
    label: "Route on",
    group: "Decision",
    type: "text",
    placeholder: "route",
    hint:
      "The question whose answer picks the outgoing transition: `conditional:<option>` for a choice, " +
      "`conditional:true` / `conditional:false` for a yes/no. A score cannot route. Every answer needs " +
      "a transition, or the node needs a `success` transition to take the rest.",
    unsetMeans: "the node advances on `success`, and exists to bind variables",
  },
  {
    key: "threshold",
    label: "Yes threshold",
    group: "Decision",
    type: "float",
    hint:
      "For a routed yes/no question: the probability of yes at or above which the answer is `true`. " +
      "Above 0 and below 1. The model's probabilities are not calibrated.",
    unsetMeans: "0.5",
    advanced: true,
  },
  {
    key: "model",
    label: "Decision model",
    group: "Decision",
    type: "text",
    placeholder: "decide",
    hint: "One of the operator's decision models. A model this runtime lacks is reported by Check, not refused at save.",
    unsetMeans: "the operator's default decision model",
    advanced: true,
  },
  {
    key: "capture",
    label: "Capture",
    group: "Decision",
    type: "kv",
    hint:
      "Variable name → a JSONPath into the answer: $.answers.<question>.choice, .noul, .score, " +
      ".confidence or .probabilities.<option>. This is how an answer reaches later prompts as ${var.<name>}.",
    unsetMeans: "no answer is kept as a variable",
  },

  // ---- the Starter (RFC CY L4) ----
  //
  // Six groups, one per handler sub-object, which is the decision C2 predicted
  // and the reason the Starter is one node rather than a container: its whole
  // configuration is six small forms, not a subgraph.
  {
    key: "source",
    label: "Source",
    group: "Source",
    type: "object",
    hint:
      "The ONE channel this Starter reads. One channel per Starter is structural, " +
      "not a limit: a channel cursor has no subscriber dimension, so two readers of " +
      "one channel share a position and compete for messages.",
    unsetMeans: "required — a starter reads exactly one channel",
    fields: [
      {
        key: "channel",
        label: "Channel",
        group: "Source",
        type: "text",
        placeholder: "sdlc-intake",
        hint: "The channel name this Starter subscribes to.",
      },
      {
        key: "wait",
        label: "Wait",
        group: "Source",
        type: "enum",
        // `all` is deliberately absent: it counts CHANNELS, and a Starter reads
        // one, so it returns after the first message. The runtime refuses it;
        // not offering it is how the canvas keeps an operator from authoring a
        // silent wrong answer in the first place.
        options: ["any", "at_least"],
        hint:
          "any dispatches on the first message; at_least holds until `n` have arrived. " +
          "(all is not offered — over a single channel it is identical to any.)",
        unsetMeans: "any — dispatch as soon as a message arrives",
      },
      {
        key: "n",
        label: "Threshold (n)",
        group: "Source",
        type: "int",
        min: 0,
        hint: "How many messages wait=at_least holds for. A floor: a dynamic upstream wave may deliver more.",
        unsetMeans: "required when wait is at_least",
      },
      {
        key: "wait_ms",
        label: "Wait timeout (ms)",
        group: "Source",
        type: "int",
        min: 0,
        hint: "How long to wait for the predicate before the walk errors.",
        unsetMeans: "the operator's long-poll cap",
        advanced: true,
      },
      {
        key: "batch",
        label: "Batch size",
        group: "Source",
        type: "int",
        min: 0,
        hint: "How many messages to read at once.",
        unsetMeans: "the store default",
        advanced: true,
      },
    ],
  },
  {
    key: "fanout",
    label: "Fan-out",
    group: "Fan-out",
    type: "object",
    hint: "How wide the wave is, and what it runs. Exactly one of `agent` or `agents`.",
    unsetMeans: "required on a starter",
    fields: [
      {
        key: "agent",
        label: "Agent",
        group: "Fan-out",
        type: "text",
        placeholder: "reviewer",
        hint: "One AgentDef, run once per message. The common case: N runs of ONE agent.",
        unsetMeans: "set `agents` instead",
      },
      {
        key: "agents",
        label: "Agents",
        group: "Fan-out",
        type: "string-list",
        placeholder: "agent name…",
        hint: "Several AgentDefs, when a wave is heterogeneous. Mutually exclusive with `agent`.",
        unsetMeans: "set `agent` instead",
      },
      {
        key: "per",
        label: "Per",
        group: "Fan-out",
        type: "enum",
        options: ["message", "once"],
        hint:
          "message spawns one run per message read — the width is however deep the channel is. " +
          "once spawns a single run holding the whole batch.",
        unsetMeans: "message — one run per message",
      },
      {
        key: "max",
        label: "Max width",
        group: "Fan-out",
        type: "int",
        min: 1,
        hint:
          "The hard ceiling on one wave. REQUIRED for per=message: dynamic fan-out is a spawn " +
          "amplifier, and a channel that accumulated a thousand messages is otherwise a thousand runs.",
        unsetMeans: "required for per=message; meaningless for per=once",
      },
      {
        key: "wait",
        label: "Wait",
        group: "Fan-out",
        type: "text",
        placeholder: "all | any | at_least:2",
        hint: "How the walk waits for the wave. Mirrors a parallel node's wait.",
        unsetMeans: "all — every run in the wave must finish",
      },
    ],
  },
  {
    key: "prompt",
    label: "Prompt",
    group: "Prompt",
    type: "object",
    hint:
      "The wave's prompt. A Starter carries its own rather than using system_prompt / " +
      "input_template, because the payload lands in the reserved {{starter.message}} / " +
      "{{starter.messages}} slots and the node needs somewhere to put the text around them.",
    unsetMeans: "the spawned agents run on their own prompts alone",
    fields: [
      {
        key: "system",
        label: "System",
        group: "Prompt",
        type: "textarea",
        hint: "This node's role, appended to the agent's own system prompt rather than replacing it.",
      },
      {
        key: "input",
        label: "Input",
        group: "Prompt",
        type: "textarea",
        placeholder: "Review this pull request:\n\n{{starter.message}}",
        hint:
          "The user prompt for each spawned run. {{starter.message}} is substituted AFTER " +
          "expansion and is never scanned as template text — the payload is untrusted.",
      },
    ],
  },
  {
    key: "sink",
    label: "Sink",
    group: "Sink",
    type: "object",
    hint:
      "Where the runtime publishes each spawned run's result — one message per run. " +
      "Declared, never instructed: an agent told in its prompt to publish may forget, and a " +
      "forgotten publish leaves a downstream wait hanging forever.",
    unsetMeans: "results go nowhere — nothing downstream can read them",
    fields: [
      {
        key: "channel",
        label: "Channel",
        group: "Sink",
        type: "text",
        placeholder: "sdlc-plans",
        hint: "The channel each result is published to.",
      },
    ],
  },
  {
    key: "channel",
    label: "Channel",
    group: "Sink",
    type: "text",
    placeholder: "verdicts",
    hint:
      "The channel this node publishes to. A `channel` node publishes only — reading a " +
      "channel is what a `starter` does.",
    unsetMeans: "required on a channel node",
  },
  {
    key: "binds",
    label: "Binds",
    group: "Data",
    type: "kv",
    hint:
      "Variable name → a JSONPath over the SOURCE MESSAGE, bound into ${var.*}. " +
      "Paths are the strict subset: $ , .key and [0] only. Values are UNTRUSTED — a channel " +
      "message may be agent-written or webhook-relayed.",
    unsetMeans: "nothing from the message is bound to a variable",
  },
  {
    key: "ack",
    label: "Ack",
    group: "Delivery",
    type: "enum",
    options: ["after_results", "after_read"],
    hint:
      "When the source cursor advances. after_results is at-least-once: a crash mid-wave " +
      "redelivers the batch. after_read is at-most-once and loses a batch to a crash.",
    unsetMeans: "after_results — at-least-once",
    advanced: true,
  },
];

// Hooks (RFC DK-P4c). The events and controls come from def-fields, so the
// canvas offers exactly what the loomcycle Web UI's TeamDef editor offers.
// Which kinds may carry them is fieldsForKind's job; lib/hooks.ts checks the
// rest the way teamgraph does.
const HOOK_FIELDS: readonly FieldSpec[] = [
  {
    key: "hooks",
    label: "Run hooks",
    group: "Hooks",
    type: "hook-events",
    options: AGENT_HOOK_EVENTS,
    hint:
      "Added to every run this node starts, after the hooks the agent itself carries. " +
      "A team can add a hook but never remove one an agent has. agent_stop with hold " +
      "parks a finished run for review.",
    unsetMeans: "only the agent's own hooks run",
  },
  {
    key: "tool_hooks",
    label: "Tool hooks",
    group: "Hooks",
    type: "tool-hooks",
    hint:
      "A tool's own pre / post hooks for the runs this node starts. The tool must be one " +
      "the agent has — the runtime refuses the run otherwise, not the save.",
    unsetMeans: "only the agent's own tool hooks run",
  },
];

export const teamHandlerRegistry: DefRegistry = {
  kind: "teamhandler",
  groups: [
    { name: "Handler" },
    { name: "Agents", hint: "Which AgentDefs this node runs." },
    {
      name: "Execution",
      hint: "How the node's run is bounded. Unset means the substrate default applies.",
    },
    { name: "Source", hint: "The channel a Starter reads, and how long it waits." },
    { name: "Fan-out", hint: "How wide the wave is, and what it runs." },
    { name: "Prompt", hint: "What each spawned run is asked to do." },
    { name: "Sink", hint: "Where results are published." },
    { name: "Data", hint: "What this node pulls out of the message it read." },
    { name: "Variables", hint: "What this node assigns into ${var.*}." },
    { name: "Decision", hint: "What a decision model is asked, and which answer routes the walk." },
    { name: "Form", hint: "The start form a client renders for this workflow." },
    { name: "Delivery", hint: "Cursor and redelivery semantics." },
    {
      name: "Hooks",
      hint: "Gates on the runs this node starts. Content: changing them forks the team.",
    },
  ],
  fields: [...FIELDS, ...HOOK_FIELDS],
};

/** Handler keys the canvas renders OUTSIDE the folded list, so the inspector
 *  can omit them without dropping them from the registry — the registry stays
 *  the complete description of the primitive (def-fields' `omitKeys` contract). */
export const HANDLER_OMIT_IN_LIST: readonly string[] = ["kind"];

/** Which registry fields are meaningful for a given kind. def-fields has no
 *  conditional-field concept, so the inspector filters with this rather than
 *  showing `agents` on a terminal state. */
/** Offered only on the kinds that start runs — teamgraph refuses hooks on
 *  the rest ("starts no run, so it cannot carry hooks"). */
const HOOK_KEYS = ["hooks", "tool_hooks"];

export function fieldsForKind(kind: string): string[] {
  switch (kind) {
    // system_prompt / input_template are offered on every kind that RUNS an
    // agent, and on no other. teamgraph does not refuse them elsewhere, but a
    // prompt on a state that runs nothing is a setting with no effect — which
    // is the failure the starter-only guards exist to prevent, just unenforced.
    case "agent":
      return ["agent", "consolidator", "system_prompt", "input_template", "timeout_ms", ...HOOK_KEYS];
    case "consolidator":
      return ["agent", "system_prompt", "input_template", "timeout_ms", ...HOOK_KEYS];
    case "parallel":
      return ["agents", "consolidator", "wait", "system_prompt", "input_template", "timeout_ms", ...HOOK_KEYS];
    case "vars":
      return ["set"];
    case "input":
      return ["schema"];
    case "starter":
      // Deliberately NOT agent/agents: a starter names its agents inside
      // `fanout`, and the runtime refuses them at the top level. Offering both
      // places would invite exactly the definition that gets rejected on save.
      return ["source", "fanout", "prompt", "sink", "binds", "ack", "timeout_ms", ...HOOK_KEYS];
    case "channel":
      return ["channel"];
    case "decision":
      // No agent, prompt or hook fields: it asks a model directly and starts
      // no run, and the runtime refuses each of those on it.
      return ["about", "questions", "route", "threshold", "model", "capture", "timeout_ms"];
    case "terminal":
      return [];
    default:
      // An unknown kind is edited by nobody here — the opaque node's fields
      // are preserved verbatim and belong to a runtime this build predates.
      return [];
  }
}
