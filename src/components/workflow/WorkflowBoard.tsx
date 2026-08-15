import { useMemo, useState } from "react";
import type { ChunkRow } from "../../lib/workflowApi";
import { allowedTargets, handlerAgents, type TeamGraph } from "../../lib/teamGraph";
import { agentIdentity } from "../../lib/agentIdentity";

// The kanban center. Columns come from the bound TeamDef's states (falling back
// to the tasks' own statuses when no team is bound); cards are the Document's
// task chunks grouped by `status`. Drag-drop is client-validated against the
// graph's transitions (loomcycle does not enforce transitions on update_chunk).

const NO_STATUS = "—";

function columnsFor(graph: TeamGraph | undefined, tasks: ChunkRow[]): string[] {
  const cols: string[] = [];
  const push = (s: string) => {
    if (s && !cols.includes(s)) cols.push(s);
  };
  if (graph) graph.states.forEach(push);
  // Append any task status the team states don't cover, so no task is hidden.
  for (const t of tasks) push(t.status || NO_STATUS);
  if (cols.length === 0) cols.push(NO_STATUS);
  return cols;
}

export default function WorkflowBoard({
  graph,
  tasks,
  onMove,
}: {
  graph?: TeamGraph;
  tasks: ChunkRow[];
  onMove: (task: ChunkRow, toStatus: string) => void;
}) {
  const columns = useMemo(() => columnsFor(graph, tasks), [graph, tasks]);
  const [dragging, setDragging] = useState<ChunkRow | null>(null);

  const byStatus = useMemo(() => {
    const m = new Map<string, ChunkRow[]>();
    for (const c of columns) m.set(c, []);
    for (const t of tasks) {
      const s = t.status || NO_STATUS;
      let arr = m.get(s);
      if (!arr) {
        arr = [];
        m.set(s, arr);
      }
      arr.push(t);
    }
    return m;
  }, [columns, tasks]);

  // Valid drop columns for the dragging task. No graph → free-form (allow any).
  const validTargets = useMemo(() => {
    if (!dragging || !graph) return null;
    return new Set(allowedTargets(graph, dragging.status || NO_STATUS));
  }, [dragging, graph]);

  return (
    <div className="wf-board">
      {columns.map((col) => {
        const isSource = dragging != null && (dragging.status || NO_STATUS) === col;
        const droppable = dragging != null && !isSource && (!validTargets || validTargets.has(col));
        const cls =
          "wf-col" +
          (dragging && !isSource ? (droppable ? " wf-col-target" : " wf-col-blocked") : "");
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
              if (dragging && droppable) onMove(dragging, col);
              setDragging(null);
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
              {(byStatus.get(col) ?? []).map((t) => (
                <div
                  key={t.id}
                  className="wf-card"
                  draggable
                  onDragStart={() => setDragging(t)}
                  onDragEnd={() => setDragging(null)}
                >
                  <div className="wf-card-title">{t.title || "(untitled)"}</div>
                  {t.type && <span className="wf-card-type">{t.type}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
