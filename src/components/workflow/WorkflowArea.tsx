import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardScope, DocRow } from "../../lib/workflowApi";
import { useWorkflowLists, useBoard } from "../../hooks/useWorkflowBoard";
import { useConnection, useLoomcycle } from "../../state/connection";
import { useUserRunStates } from "../../hooks/useUserRunStates";
import { useUserInterrupts } from "../../hooks/useUserInterrupts";
import { canTransition } from "../../lib/teamGraph";
import { runsByChunk } from "../../lib/boardRuns";
import { buildConnection } from "../../lib/buildConnection";
import WorkflowLeft from "./WorkflowLeft";
import WorkflowBoard from "./WorkflowBoard";
import WorkflowChatDock from "./WorkflowChatDock";

// How often to re-query task chunk statuses while a board is open (live card
// movement). The agent miniatures update live off the run-state SSE; only the
// card statuses need this poll.
const REFRESH_MS = 5000;

// How many agent chats the right-panel dock hosts at once (RFC BT P4: "1–3").
const MAX_PANES = 3;

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
  const { data, loading, error, bindTeam, moveTask, refreshTasks } = useBoard(
    scope,
    selected,
    teams,
  );

  // Live layer: one aggregate run-state stream + one interrupts poll for all
  // runs; group the runs by the board chunk they carry (loomcycle ≥1.54 stamps
  // parent_context.board_chunk_id on board-bound handler runs) → miniatures.
  const client = useLoomcycle();
  const { principal, settings } = useConnection();
  const userId = principal?.subject ?? "";
  const { tiles } = useUserRunStates(client, userId);
  const interrupts = useUserInterrupts(client, userId);
  const runsForChunk = useMemo(() => runsByChunk(tiles), [tiles]);

  // Right-panel chat dock (M3/M4): selecting a card's agent miniature opens that
  // run's live chat here — up to MAX_PANES stacked at once. Opening a new run
  // beyond the cap drops the oldest; reselecting an open run just refocuses it.
  // `focusedRunId` owns the Escape key (only that pane's turn-cancel fires).
  const connection = useMemo(() => (settings ? buildConnection(settings) : null), [settings]);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  const selectRun = useCallback((runId: string) => {
    setSelectedRunIds((ids) => (ids.includes(runId) ? ids : [...ids, runId].slice(-MAX_PANES)));
    setFocusedRunId(runId);
  }, []);
  const closeRun = useCallback((runId: string) => {
    setSelectedRunIds((ids) => ids.filter((id) => id !== runId));
    setFocusedRunId((f) => (f === runId ? null : f));
  }, []);
  // Resolve the selected ids to live tiles (a completed run stays in `tiles`, so
  // its pane persists until closed); drop any the stream no longer knows.
  const dockRuns = useMemo(
    () =>
      selectedRunIds
        .map((id) => tiles.find((t) => t.runId === id))
        .filter((t): t is (typeof tiles)[number] => t != null),
    [selectedRunIds, tiles],
  );

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t] as const)), [tasks]);
  const graph = data?.graph;
  const draggingTask = draggingId ? (tasksById.get(draggingId) ?? null) : null;

  // Reset the section selection when the board Document changes.
  useEffect(() => {
    setSectionId(null);
  }, [selected?.document_id]);

  // Poll task statuses while a board is open so cards move as agents drive them.
  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => void refreshTasks(), REFRESH_MS);
    return () => clearInterval(id);
  }, [selected, refreshTasks]);

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
              runsByChunk={runsForChunk}
              interrupts={interrupts}
              draggingTask={draggingTask}
              onDragStart={startDrag}
              onDragEnd={endDrag}
              onDrop={onDrop}
              onSelectRun={selectRun}
            />
          )}
        </div>

        {connection && dockRuns.length > 0 && (
          <WorkflowChatDock
            connection={connection}
            client={client}
            runs={dockRuns}
            interrupts={interrupts}
            focusedRunId={focusedRunId}
            onFocus={setFocusedRunId}
            onClose={closeRun}
          />
        )}
      </div>
    </section>
  );
}
