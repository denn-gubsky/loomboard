// A TypeScript mirror of `internal/teamgraph.Validate`, run as the operator
// draws rather than when the server refuses the save.
//
// WHY mirror rather than round-trip to the server: these are the same
// invariants `op=create` enforces, but a create-time error string arrives after
// the graph is already wrong. Surfacing them while drawing turns "team
// definition: state %q is unreachable from entry %q" into a highlighted node.
//
// THE ONE DELIBERATE DIVERGENCE: an unknown handler kind is NOT an error here.
// The Go validator rejects it, and correctly — but this canvas may simply be
// older than the runtime it is talking to (RFC CZ decision 3). Flagging a
// `starter` node red because this build predates RFC CY L4 would be wrong and
// would push operators back to hand-editing JSON. Unknown kinds are reported at
// `info` and their handler-shape rules are skipped entirely, because we cannot
// know what fields they require.
//
// Drift between this file and validate.go is the likeliest silent bug in the
// package, which is why validate.test.ts drives BOTH from one fixture set.

import type { CanvasModel, CanvasNode, JsonObject } from "./model";
import { handlerOf } from "./model";
import { parseJsonPath } from "./jsonpath";

/** Mirrors teamgraph.MaxAllowedIterations. */
export const MAX_ALLOWED_ITERATIONS = 1000;

/** Mirrors teamgraph's varNameRe. */
const VAR_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export type FindingLevel = "error" | "info";

export interface Finding {
  level: FindingLevel;
  /** Operator-facing. Phrased like the Go error it mirrors, minus the
   *  "team definition:" prefix the server adds. */
  message: string;
  /** The state this finding attaches to, for highlighting. */
  nodeId?: string;
  /** The transition index this finding attaches to. */
  edgeIndex?: number;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function agentsOf(n: CanvasNode): string[] {
  const raw = handlerOf(n).agents;
  return Array.isArray(raw) ? raw.map((a) => (typeof a === "string" ? a : "")) : [];
}

function obj(v: unknown): JsonObject | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as JsonObject) : undefined;
}

/** A JSON number read as Go would read an int field: anything non-numeric is
 *  the zero value, which is also what `omitempty` writes for "absent". */
function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((a) => (typeof a === "string" ? a : "")) : [];
}

/** Mirrors validateCapture. Used for a Starter's `binds`, which is the same
 *  name→JSONPath shape and goes through the same Go function — which is why the
 *  message says "capture" even when the operator edited `binds`. Kept verbatim:
 *  a mirror that improves the wording is a mirror that cannot be diffed. */
function validateCaptureMap(m: JsonObject): string[] {
  const out: string[] = [];
  for (const name of Object.keys(m).sort()) {
    if (!VAR_NAME_RE.test(name)) {
      out.push(`capture key ${JSON.stringify(name)} must match [a-zA-Z0-9_-]{1,64}`);
      continue;
    }
    const path = m[name];
    const err = parseJsonPath(typeof path === "string" ? path : "");
    if (err) out.push(`capture ${JSON.stringify(name)}: ${err}`);
  }
  return out;
}

/** Mirrors validateStarter.
 *
 *  Go returns on the FIRST problem; this collects, because an inspector showing
 *  one error at a time turns fixing a Starter into six round trips. The pass/
 *  fail verdict the shared fixtures assert is identical either way — but where a
 *  later check would read a field an earlier one just rejected, this returns
 *  early too, so it never reports a consequence as a second cause. */
function validateStarter(h: JsonObject): string[] {
  const out: string[] = [];

  // NOT trimmed, deliberately: Go compares these two against "" directly here
  // (unlike `fanout.agent` just below, which it does trim). A handler carrying
  // `agent: " "` is refused by the runtime, so the mirror must refuse it too —
  // trimming first would let a definition through that then fails on save.
  if (str(h.agent) || strList(h.agents).length || str(h.consolidator)) {
    return ["starter handler names its agents in `fanout`, not in agent/agents/consolidator"];
  }

  const source = obj(h.source);
  if (!source || !str(source.channel).trim()) {
    return ["starter handler requires `source.channel` — a starter reads exactly one channel"];
  }
  const wait = str(source.wait);
  switch (wait) {
    case "":
    case "any":
      break;
    case "at_least":
      if (num(source.n) < 1) out.push("starter source wait=at_least requires `n` >= 1");
      break;
    case "all":
      // `all` counts CHANNELS, and a starter reads one — so it returns after the
      // first message. A silent wrong answer, which is why it is refused rather
      // than normalised to `any`.
      out.push(
        'starter source wait="all" counts CHANNELS, and a starter reads ONE — ' +
          "over one channel it returns after the first message. Use at_least with `n`, or any",
      );
      break;
    default:
      out.push(`starter source has invalid wait ${JSON.stringify(wait)} (want any|at_least)`);
  }
  if (num(source.wait_ms) < 0 || num(source.batch) < 0 || num(source.n) < 0) {
    out.push("starter source wait_ms/batch/n must be >= 0");
  }

  const fanout = obj(h.fanout);
  if (!fanout) {
    out.push("starter handler requires `fanout`");
    return out;
  }
  const fanAgents = strList(fanout.agents);
  const hasOne = !!str(fanout.agent).trim();
  const hasMany = fanAgents.length > 0;
  if (hasOne === hasMany) out.push("starter fanout needs exactly one of `agent` or `agents`");
  if (fanAgents.some((a) => !a.trim())) out.push("starter fanout has an empty agent name");

  const per = str(fanout.per);
  switch (per) {
    case "":
    case "message":
      if (num(fanout.max) < 1) {
        out.push(
          "starter fanout per=message requires `max` >= 1 — " +
            "the wave is as wide as the channel is deep, so the ceiling is not optional",
        );
      }
      break;
    case "once":
      if (num(fanout.max) !== 0) {
        out.push("starter fanout per=once spawns one run, so `max` means nothing");
      }
      break;
    default:
      out.push(`starter fanout has invalid per ${JSON.stringify(per)} (want message|once)`);
  }
  const fanWait = validateWait(str(fanout.wait));
  if (fanWait) out.push(fanWait);

  const binds = obj(h.binds);
  // binds project THE source message; per=once hands the agent the whole batch,
  // so there is no "the" message to project from.
  if (per === "once" && binds && Object.keys(binds).length) {
    out.push(
      "starter has `binds` with per=once — " +
        "binds project ONE source message, and per=once hands the agent the whole batch",
    );
  }

  const sink = obj(h.sink);
  if (sink && !str(sink.channel).trim()) {
    out.push("starter `sink` is present but names no channel");
  }

  const ack = str(h.ack);
  if (ack !== "" && ack !== "after_results" && ack !== "after_read") {
    out.push(`starter has invalid ack ${JSON.stringify(ack)} (want after_results|after_read)`);
  }

  if (binds) out.push(...validateCaptureMap(binds));
  return out;
}

/** Mirrors validateWait: "" | all | any | at_least:<positive int>. */
export function validateWait(wait: string): string | null {
  if (wait === "" || wait === "all" || wait === "any") return null;
  if (wait.startsWith("at_least:")) {
    const n = Number(wait.slice("at_least:".length));
    if (!Number.isInteger(n) || n < 1) {
      return `wait ${JSON.stringify(wait)}: at_least:<N> needs a positive integer`;
    }
    return null;
  }
  return `invalid wait ${JSON.stringify(wait)} (want all|any|at_least:<N>)`;
}

/** Mirrors validateOn: success | pushback:<reason> | conditional:<expr>. */
export function validateOn(on: string): string | null {
  if (on === "success") return null;
  for (const prefix of ["pushback", "conditional"] as const) {
    if (on.startsWith(prefix + ":")) {
      const rest = on.slice(prefix.length + 1).trim();
      if (!rest) {
        return prefix === "pushback"
          ? "pushback: needs a non-empty reason"
          : "conditional: needs a non-empty expression";
      }
      return null;
    }
  }
  return `invalid \`on\` ${JSON.stringify(on)} (want success | pushback:<reason> | conditional:<expr>)`;
}

/** Mirrors validateHandler for the kinds this canvas knows. Returns [] for an
 *  unknown kind — see the header. */
function validateHandler(n: CanvasNode): string[] {
  const h = handlerOf(n);
  const out: string[] = [];
  const agent = str(h.agent).trim();
  const agents = agentsOf(n);
  const consolidator = str(h.consolidator).trim();

  switch (n.kind) {
    case "agent":
    case "consolidator":
      if (!agent) out.push(`handler kind ${JSON.stringify(n.kind)} requires \`agent\``);
      if (agents.length) {
        out.push(`handler kind ${JSON.stringify(n.kind)} must not set \`agents\` (use \`agent\`)`);
      }
      break;
    case "parallel":
      if (!agents.length) out.push("parallel handler requires a non-empty `agents`");
      if (agents.some((a) => !a.trim())) out.push("parallel handler has an empty agent name");
      if (!consolidator) out.push("parallel handler requires a `consolidator` agent");
      {
        const w = validateWait(str(h.wait));
        if (w) out.push(w);
      }
      break;
    case "terminal":
      if (agent || agents.length || consolidator) {
        out.push("terminal handler must not set agent/agents/consolidator");
      }
      break;
    case "starter":
      out.push(...validateStarter(h));
      break;
    case "channel":
      // Publish-only. Reading a channel is what a `starter` is for, and the
      // two were one kind before RFC CY L4 split them — so a definition written
      // against the old shape lands here rather than silently half-working.
      if (!str(h.channel).trim()) out.push("channel handler requires `channel`");
      if (agent || agents.length || consolidator) {
        out.push("channel handler must not set agent/agents/consolidator — it publishes, it does not run");
      }
      if (obj(h.source)) {
        out.push("channel handler must not set `source` — reading a channel is a `starter`, not a `channel`");
      }
      break;
    case "":
      // Go returns here, so none of the cross-kind guards below run for a
      // kindless handler. Mirrored, or a missing `kind` would also be reported
      // as five stray-field errors.
      return ["handler is missing a `kind`"];
    default:
      // Unknown kind: defer to the server. Deliberately no shape rules.
      return [];
  }

  // ---- fields that belong to exactly one kind ----
  //
  // Left on another kind they read as configured and do nothing. That is the
  // failure this whole block exists to prevent, and it is why the runtime
  // refuses rather than ignores them.
  if (n.kind !== "starter") {
    if (obj(h.source)) out.push(`sets \`source\` but is kind ${JSON.stringify(n.kind)} (starter only)`);
    else if (obj(h.fanout)) out.push(`sets \`fanout\` but is kind ${JSON.stringify(n.kind)} (starter only)`);
    else if (obj(h.sink)) out.push(`sets \`sink\` but is kind ${JSON.stringify(n.kind)} (starter only)`);
    else if (Object.keys(obj(h.binds) ?? {}).length) {
      out.push(`sets \`binds\` but is kind ${JSON.stringify(n.kind)} (starter only)`);
    } else if (str(h.ack)) out.push(`sets \`ack\` but is kind ${JSON.stringify(n.kind)} (starter only)`);
    else if (obj(h.prompt)) {
      out.push(
        `sets \`prompt\` but is kind ${JSON.stringify(n.kind)} — ` +
          "another kind's prompts are `system_prompt` + `input_template`",
      );
    }
  }
  if (n.kind !== "channel" && str(h.channel).trim()) {
    out.push(
      `sets \`channel\` but is kind ${JSON.stringify(n.kind)} — ` +
        "a starter names its channels in `source`/`sink`",
    );
  }
  // `vars` and `input` are opaque to this canvas version and returned above, so
  // these two only ever fire on a kind that should not carry the field at all.
  if (Object.keys(obj(h.set) ?? {}).length) {
    out.push(
      `sets \`set\` but is kind ${JSON.stringify(n.kind)} — ` +
        "assignment belongs on a `vars` state, where it is visible",
    );
  }
  if (h.schema !== undefined) {
    out.push(`sets \`schema\` but is kind ${JSON.stringify(n.kind)} (input only)`);
  }

  const timeout = h.timeout_ms;
  if (typeof timeout === "number" && timeout < 0) out.push("handler timeout_ms must be >= 0");
  return out;
}

/** Run the mirror over a model. Ordered roughly as validate.go orders its
 *  checks, so a graph with several problems surfaces them in a familiar order. */
export function validateModel(model: CanvasModel): Finding[] {
  const findings: Finding[] = [];
  const err = (message: string, extra?: Partial<Finding>) =>
    findings.push({ level: "error", message, ...extra });

  // ---- entry + states ----
  if (!model.entry.trim()) err("`entry` is required");
  if (!model.nodes.length) err("at least one state is required");

  const byId = new Map<string, CanvasNode>();
  for (const n of model.nodes) {
    if (!n.id.trim()) {
      err("a state has an empty `state` id", { nodeId: n.id });
      continue;
    }
    if (byId.has(n.id)) err(`duplicate state id ${JSON.stringify(n.id)}`, { nodeId: n.id });
    else byId.set(n.id, n);
    for (const m of validateHandler(n)) err(`state ${JSON.stringify(n.id)} ${m}`, { nodeId: n.id });
    if (n.opaque && n.kind) {
      findings.push({
        level: "info",
        nodeId: n.id,
        message:
          `handler kind ${JSON.stringify(n.kind)} is not known to this canvas version — ` +
          `it is preserved unchanged and validated by the runtime`,
      });
    }
  }

  if (model.entry.trim() && !byId.has(model.entry)) {
    err(`entry ${JSON.stringify(model.entry)} does not resolve to a state`);
  }

  const maxIter = model.source.max_iterations;
  if (typeof maxIter === "number") {
    if (maxIter < 0) err("max_iterations must be >= 0 (0 = default)");
    else if (maxIter > MAX_ALLOWED_ITERATIONS) {
      err(`max_iterations ${maxIter} exceeds the maximum ${MAX_ALLOWED_ITERATIONS}`);
    }
  }

  // ---- transitions ----
  const outbound = new Map<string, Set<string>>();
  const adj = new Map<string, string[]>();
  model.edges.forEach((e, i) => {
    if (!byId.has(e.from)) {
      err(`transition[${i}] from ${JSON.stringify(e.from)} does not resolve to a state`, {
        edgeIndex: i,
      });
      return;
    }
    if (!byId.has(e.to)) {
      err(`transition[${i}] to ${JSON.stringify(e.to)} does not resolve to a state`, {
        edgeIndex: i,
      });
      return;
    }
    const onErr = validateOn(e.on);
    if (onErr) err(`transition[${i}] ${onErr}`, { edgeIndex: i });

    if (byId.get(e.from)!.kind === "terminal") {
      err(`terminal state ${JSON.stringify(e.from)} must have no outbound transitions`, {
        nodeId: e.from,
        edgeIndex: i,
      });
    }

    let labels = outbound.get(e.from);
    if (!labels) outbound.set(e.from, (labels = new Set()));
    if (labels.has(e.on)) {
      err(
        `state ${JSON.stringify(e.from)} has duplicate outbound transition label ` +
          `${JSON.stringify(e.on)} (ambiguous route)`,
        { nodeId: e.from, edgeIndex: i },
      );
    }
    labels.add(e.on);
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  });

  // ---- reachability from entry (BFS, mirroring validate.go) ----
  if (byId.has(model.entry)) {
    const seen = new Set([model.entry]);
    const queue = [model.entry];
    while (queue.length) {
      for (const next of adj.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const n of byId.values()) {
      if (!seen.has(n.id)) {
        err(`state ${JSON.stringify(n.id)} is unreachable from entry ${JSON.stringify(model.entry)}`, {
          nodeId: n.id,
        });
      }
    }
  }

  // ---- dead ends ----
  // An unknown kind is skipped: we cannot tell whether it is terminal-like, and
  // a false "dead end" on a node the runtime is happy with would be worse than
  // saying nothing.
  for (const n of byId.values()) {
    if (n.kind === "terminal" || n.opaque) continue;
    if (!outbound.get(n.id)?.size) {
      err(`non-terminal state ${JSON.stringify(n.id)} has no outbound transition (dead end)`, {
        nodeId: n.id,
      });
    }
  }

  return findings;
}

/** True when nothing the server would refuse remains. `info` findings do not
 *  block a save. */
export function canSave(findings: Finding[]): boolean {
  return !findings.some((f) => f.level === "error");
}
