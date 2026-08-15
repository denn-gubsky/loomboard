import type { TeamNameSummary } from "@loomcycle/client";
import type { DocRow } from "../../lib/workflowApi";

// Left panel: pick a board Document, and bind a TeamDef to it (the binding is a
// loomboard convention stored in the board's root-chunk fields). The team's
// state machine supplies the board columns.
export default function WorkflowLeft({
  boards,
  teams,
  selectedDocId,
  onSelectBoard,
  boundTeam,
  onBindTeam,
  listLoading,
  listError,
}: {
  boards: DocRow[];
  teams: TeamNameSummary[];
  selectedDocId: string | null;
  onSelectBoard: (b: DocRow) => void;
  boundTeam?: string;
  onBindTeam: (name: string | undefined) => void;
  listLoading: boolean;
  listError: string | null;
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
          <ul className="wf-list">
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
        {boundTeam && <div className="wf-dim wf-team-note">Columns follow this team's states.</div>}
      </div>
    </div>
  );
}
