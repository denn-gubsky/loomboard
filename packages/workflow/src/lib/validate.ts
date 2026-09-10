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

import type { CanvasModel, CanvasNode } from "./model";
import { handlerOf } from "./model";

/** Mirrors teamgraph.MaxAllowedIterations. */
export const MAX_ALLOWED_ITERATIONS = 1000;

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
    case "":
      out.push("handler is missing a `kind`");
      break;
    default:
      // Unknown kind: defer to the server. Deliberately no shape rules.
      return [];
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
