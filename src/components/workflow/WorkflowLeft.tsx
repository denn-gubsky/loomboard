import type { TeamNameSummary } from "@loomcycle/client";
import type { ChunkRow, DocRow } from "../../lib/workflowApi";
import WorkflowTree from "./WorkflowTree";

// Left panel: pick a board Document, navigate its chunk TREE (select a section,
// drag its child tasks onto the board), and bind a TeamDef (the binding is a
// loomboard convention in the board's root-chunk fields). The team's states
// become the board columns.
export default function WorkflowLeft({
  boards,
  teams,
  selectedDocId,
  onSelectBoard,
  boundTeam,
  onBindTeam,
  listLoading,
  listError,
  tasks,
  rootChunkId,
  sectionId,
  onSelectSection,
  onDragStart,
  onDragEnd,
}: {
  boards: DocRow[];
  teams: TeamNameSummary[];
  selectedDocId: string | null;
  onSelectBoard: (b: DocRow) => void;
  boundTeam?: string;
  onBindTeam: (name: string | undefined) => void;
  listLoading: boolean;
  listError: string | null;
  tasks: ChunkRow[];
  rootChunkId?: string;
  sectionId: string | null;
  onSelectSection: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="wf-left">
      <div className="wf-left-section">
        <div className="wf-left-title">Boards</div>
        {listError ? (
          <div className="wf-error">{listError}</div>
        ) : listLoading ? (
          <div className="wf-dim">Loading…</div>
        ) : boards.length === 0 ? (
          <div className="wf-dim">No documents in this scope.</div>
        ) : (
          <ul className="wf-list wf-boards">
            {boards.map((b) => (
              <li key={b.document_id}>
                <button
                  type="button"
                  className={b.document_id === selectedDocId ? "wf-item on" : "wf-item"}
                  onClick={() => onSelectBoard(b)}
                >
                  {b.title || "(untitled)"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedDocId && (
        <div className="wf-left-section wf-left-tree">
          <div className="wf-left-title">Document — drag tasks to the board</div>
          <WorkflowTree
            tasks={tasks}
            rootChunkId={rootChunkId}
            sectionId={sectionId}
            onSelectSection={onSelectSection}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
      )}

      <div className="wf-left-section">
        <div className="wf-left-title">Team</div>
        <select
          className="wf-team-select"
          value={boundTeam ?? ""}
          onChange={(e) => onBindTeam(e.target.value || undefined)}
          disabled={!selectedDocId}
          title={selectedDocId ? "Bind a TeamDef to this board" : "Pick a board first"}
        >
          <option value="">— no team —</option>
          {teams.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
