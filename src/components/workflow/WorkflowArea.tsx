import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardScope, DocRow } from "../../lib/workflowApi";
import { useWorkflowLists, useBoard } from "../../hooks/useWorkflowBoard";
import { canTransition } from "../../lib/teamGraph";
import WorkflowLeft from "./WorkflowLeft";
import WorkflowBoard from "./WorkflowBoard";

// The Workflow surface (RFC BT P4 / RFC AC): a live operational board for
// agentic teams. M1 = the static operable board — pick a board Document,
// navigate its chunk tree, bind a TeamDef (its states become the columns), and
// drag tasks (tree → column, or column → column) to walk them through the team's
// states, client-validated against the graph. Live agent miniatures + the
// right-panel chats land in later milestones.
export default function WorkflowArea() {
  const [scope, setScope] = useState<BoardScope>("user");
  const [selected, setSelected] = useState<DocRow | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const { boards, teams, loading: listLoading, error: listError } = useWorkflowLists(scope);
  const { data, loading, error, bindTeam, moveTask } = useBoard(scope, selected, teams);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t] as const)), [tasks]);
  const graph = data?.graph;
  const draggingTask = draggingId ? (tasksById.get(draggingId) ?? null) : null;

  // Reset the section selection when the board Document changes.
  useEffect(() => {
    setSectionId(null);
  }, [selected?.document_id]);

  const startDrag = useCallback((id: string) => setDraggingId(id), []);
  const endDrag = useCallback(() => setDraggingId(null), []);

  // A drop places/moves the chunk into a column's state. From an unassigned tree
  // task → any state (initial placement); from a state → an allowed transition.
  const onDrop = useCallback(
    (id: string, toStatus: string) => {
      setDraggingId(null);
      const task = tasksById.get(id);
      if (!task) return;
      const from = task.status || "";
      if (from === toStatus) return;
      if (graph && graph.states.includes(from) && !canTransition(graph, from, toStatus)) return;
      void moveTask(task, toStatus);
    },
    [tasksById, graph, moveTask],
  );

  return (
    <section className="workflow-pane">
      <div className="wf-toolbar">
        <div className="scope-toggle" role="tablist" aria-label="Scope">
          {(["user", "tenant"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              className={scope === s ? "on" : ""}
              onClick={() => {
                setScope(s);
                setSelected(null);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {data?.doc && <span className="wf-board-title">{data.doc.title}</span>}
      </div>

      <div className="wf-body">
        <WorkflowLeft
          boards={boards}
          teams={teams}
          selectedDocId={selected?.document_id ?? null}
          onSelectBoard={setSelected}
          boundTeam={data?.team}
          onBindTeam={bindTeam}
          listLoading={listLoading}
          listError={listError}
          tasks={tasks}
          rootChunkId={selected?.root_chunk_id}
          sectionId={sectionId}
          onSelectSection={setSectionId}
          onDragStart={startDrag}
          onDragEnd={endDrag}
        />

        <div className="wf-center">
          {!selected ? (
            <div className="wf-placeholder">Pick a board on the left.</div>
          ) : error ? (
            <div className="wf-error">{error}</div>
          ) : !data ? (
            <div className="wf-dim">{loading ? "Loading board…" : ""}</div>
          ) : !data.team ? (
            <div className="wf-hint">
              Bind a team (left) — its states become the columns you drag tasks into.
            </div>
          ) : (
            <WorkflowBoard
              graph={graph}
              tasks={tasks}
              draggingTask={draggingTask}
              onDragStart={startDrag}
              onDragEnd={endDrag}
              onDrop={onDrop}
            />
          )}
        </div>
      </div>
    </section>
  );
}
