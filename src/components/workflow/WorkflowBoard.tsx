import { useMemo } from "react";
import type { InterruptRow } from "@loomcycle/client";
import type { ChunkRow } from "../../lib/workflowApi";
import type { RunTile } from "../../lib/runStates";
import { allowedTargets, handlerAgents, type TeamGraph } from "../../lib/teamGraph";
import { agentIdentity } from "../../lib/agentIdentity";

// The kanban center. Columns come from the bound TeamDef's states (plus any
// extra statuses assigned tasks already carry). Cards are the Document's task
// chunks that have a status; UNASSIGNED chunks live in the left tree and are
// dragged here to be placed. Drag carries the chunk id via dataTransfer so a
// drop works whether the drag started in the tree or on another card. Moves are
// validated in WorkflowArea against the team graph (loomcycle does not enforce
// transitions on update_chunk).

const NO_STATUS = "—";

function columnsFor(graph: TeamGraph | undefined, assigned: ChunkRow[]): string[] {
  const cols: string[] = [];
  const push = (s: string) => {
    if (s && !cols.includes(s)) cols.push(s);
  };
  if (graph) graph.states.forEach(push);
  for (const t of assigned) push(t.status ?? "");
  if (cols.length === 0) cols.push(NO_STATUS);
  return cols;
}

export default function WorkflowBoard({
  graph,
  tasks,
  runsByChunk,
  interrupts,
  draggingTask,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  graph?: TeamGraph;
  tasks: ChunkRow[];
  /** chunk id → the live agent runs working it (loomcycle ≥1.54 pinning). */
  runsByChunk: Map<string, RunTile[]>;
  /** run id → its pending interruption (awaiting-input badge). */
  interrupts: Map<string, InterruptRow>;
  draggingTask: ChunkRow | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (id: string, toStatus: string) => void;
}) {
  const assigned = useMemo(() => tasks.filter((t) => t.status), [tasks]);
  const columns = useMemo(() => columnsFor(graph, assigned), [graph, assigned]);

  const byStatus = useMemo(() => {
    const m = new Map<string, ChunkRow[]>();
    for (const c of columns) m.set(c, []);
    for (const t of assigned) {
      const s = t.status || NO_STATUS;
      let arr = m.get(s);
      if (!arr) {
        arr = [];
        m.set(s, arr);
      }
      arr.push(t);
    }
    return m;
  }, [columns, assigned]);

  // Valid drop columns for the dragging task. An UNASSIGNED task (no team-state
  // status), or no graph → any column is valid (initial placement).
  const validTargets = useMemo(() => {
    if (!draggingTask || !graph) return null;
    const from = draggingTask.status || "";
    if (!graph.states.includes(from)) return null;
    return new Set(allowedTargets(graph, from));
  }, [draggingTask, graph]);

  return (
    <div className="wf-board">
      {columns.map((col) => {
        const isSource = draggingTask != null && (draggingTask.status || "") === col;
        const droppable =
          draggingTask != null && !isSource && (!validTargets || validTargets.has(col));
        const cls =
          "wf-col" +
          (draggingTask && !isSource
            ? droppable
              ? " wf-col-target"
              : " wf-col-blocked"
            : "");
        const agents = graph ? handlerAgents(graph, col) : [];
        return (
          <div
            key={col}
            className={cls}
            onDragOver={(e) => {
              if (droppable) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id && droppable) onDrop(id, col);
              onDragEnd();
            }}
          >
            <div className="wf-col-head">
              <span className="wf-col-name">{col}</span>
              <span className="wf-col-count">{byStatus.get(col)?.length ?? 0}</span>
            </div>
            {agents.length > 0 && (
              <div className="wf-col-agents">
                {agents.map((a) => {
                  const id = agentIdentity(a);
                  const Icon = id.Icon;
                  return (
                    <span key={a} className="wf-col-agent" title={a} style={{ color: id.color }}>
                      <Icon size={13} />
                    </span>
                  );
                })}
              </div>
            )}
            <div className="wf-col-body">
              {(byStatus.get(col) ?? []).map((t) => {
                const runs = runsByChunk.get(t.id) ?? [];
                const needsInput = runs.some((r) => interrupts.has(r.runId));
                return (
                  <div
                    key={t.id}
                    className="wf-card"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      onDragStart(t.id);
                    }}
                    onDragEnd={onDragEnd}
                  >
                    <div className="wf-card-title">{t.title || "(untitled)"}</div>
                    <div className="wf-card-foot">
                      {t.type && <span className="wf-card-type">{t.type}</span>}
                      {runs.length > 0 && (
                        <span className="wf-card-minis">
                          {runs.map((r) => {
                            const rid = agentIdentity(r.agent);
                            const Icon = rid.Icon;
                            const ni = interrupts.has(r.runId);
                            return (
                              <span
                                key={r.runId}
                                className={ni ? "wf-mini needs-input" : "wf-mini running"}
                                title={`${r.agent} — ${ni ? "needs input" : "working"}`}
                                style={{ color: rid.color }}
                              >
                                <Icon size={12} />
                              </span>
                            );
                          })}
                        </span>
                      )}
                      {needsInput && (
                        <span className="wf-card-needs" title="An agent needs your answer">
                          needs answer
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
