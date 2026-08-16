// Pure parsing of a loomcycle TeamDef `definition` (typed `unknown` on the wire —
// getTeamDef → TeamDefDetail.definition) into the workflow board's view model:
// the ordered states (the kanban columns), the allowed transitions between them
// (the valid drag-drop targets), and each state's handler agent(s). Defensive: a
// malformed / partial definition degrades gracefully so the board still renders.
//
// Wire shape (from the loomcycle teamgraph package):
//   { entry, states: [{ state, handler }], transitions: [{ from, to, on }], colors }
//   handler = { kind: "agent"|"parallel"|"consolidator"|"terminal",
//               agent?, agents?[], consolidator?, ... }
//   on = "success" | "pushback:<reason>" | "conditional:<expr>"

export interface TeamTransition {
  from: string;
  to: string;
  /** "success" | "pushback:<reason>" | "conditional:<expr>". */
  on: string;
}

export interface TeamHandler {
  kind: string; // "agent" | "parallel" | "consolidator" | "terminal"
  agent?: string;
  agents?: string[];
  consolidator?: string;
}

export interface TeamGraph {
  entry?: string;
  /** State ids in declared order — the kanban columns. */
  states: string[];
  transitions: TeamTransition[];
  /** state id → handler. */
  handlers: Record<string, TeamHandler>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function parseHandler(h: unknown): TeamHandler {
  if (!h || typeof h !== "object") return { kind: "agent" };
  const o = h as Record<string, unknown>;
  const handler: TeamHandler = { kind: str(o.kind) ?? "agent" };
  const agent = str(o.agent);
  if (agent) handler.agent = agent;
  if (Array.isArray(o.agents)) {
    const agents = o.agents.filter((a): a is string => typeof a === "string" && !!a);
    if (agents.length) handler.agents = agents;
  }
  const consolidator = str(o.consolidator);
  if (consolidator) handler.consolidator = consolidator;
  return handler;
}

/** Parse a TeamDef `definition` into the board graph. */
export function parseTeamGraph(definition: unknown): TeamGraph {
  const empty: TeamGraph = { states: [], transitions: [], handlers: {} };
  if (!definition || typeof definition !== "object") return empty;
  const d = definition as Record<string, unknown>;

  const states: string[] = [];
  const handlers: Record<string, TeamHandler> = {};
  if (Array.isArray(d.states)) {
    for (const s of d.states) {
      if (!s || typeof s !== "object") continue;
      const id = str((s as Record<string, unknown>).state);
      if (!id || states.includes(id)) continue;
      states.push(id);
      handlers[id] = parseHandler((s as Record<string, unknown>).handler);
    }
  }

  const transitions: TeamTransition[] = [];
  if (Array.isArray(d.transitions)) {
    for (const t of d.transitions) {
      if (!t || typeof t !== "object") continue;
      const o = t as Record<string, unknown>;
      const from = str(o.from);
      const to = str(o.to);
      if (!from || !to) continue;
      transitions.push({ from, to, on: str(o.on) ?? "success" });
    }
  }

  return { entry: str(d.entry), states, transitions, handlers };
}

/** The states reachable in one step from `from` — the valid drag-drop targets. */
export function allowedTargets(graph: TeamGraph, from: string): string[] {
  return graph.transitions.filter((t) => t.from === from).map((t) => t.to);
}

/** Whether a card in state `from` may be moved to state `to`. */
export function canTransition(graph: TeamGraph, from: string, to: string): boolean {
  if (from === to) return false;
  return graph.transitions.some((t) => t.from === from && t.to === to);
}

/** The agent name(s) a state's handler runs — for the column / card handler badge. */
export function handlerAgents(graph: TeamGraph, state: string): string[] {
  const h = graph.handlers[state];
  if (!h) return [];
  if (h.agent) return [h.agent];
  if (h.agents?.length) return h.agents;
  if (h.consolidator) return [h.consolidator];
  return [];
}
