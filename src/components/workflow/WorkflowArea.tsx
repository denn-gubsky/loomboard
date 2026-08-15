import { useState } from "react";
import type { BoardScope, DocRow } from "../../lib/workflowApi";
import { useWorkflowLists, useBoard } from "../../hooks/useWorkflowBoard";
import WorkflowLeft from "./WorkflowLeft";
import WorkflowBoard from "./WorkflowBoard";

// The Workflow surface (RFC BT P4 / RFC AC): a live operational board for
// agentic teams. M1 = the static operable board — pick a board Document, bind a
// TeamDef (its states become the columns), and move tasks between states
// (client-validated against the team's transitions). Live agent miniatures + the
// right-panel chats land in later milestones.
export default function WorkflowArea() {
  const [scope, setScope] = useState<BoardScope>("user");
  const [selected, setSelected] = useState<DocRow | null>(null);

  const { boards, teams, loading: listLoading, error: listError } = useWorkflowLists(scope);
  const { data, loading, error, bindTeam, moveTask } = useBoard(scope, selected, teams);

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
        />

        <div className="wf-center">
          {!selected ? (
            <div className="wf-placeholder">Pick a board on the left.</div>
          ) : error ? (
            <div className="wf-error">{error}</div>
          ) : !data ? (
            <div className="wf-dim">{loading ? "Loading board…" : ""}</div>
          ) : (
            <>
              {!data.team && (
                <div className="wf-hint">
                  No team bound — columns come from the tasks' current status. Bind a team
                  (left) for its state machine + transition validation.
                </div>
              )}
              {data.tasks.length === 0 ? (
                <div className="wf-placeholder">This board has no task chunks yet.</div>
              ) : (
                <WorkflowBoard graph={data.graph} tasks={data.tasks} onMove={moveTask} />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
