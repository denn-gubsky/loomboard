import { useState } from "react";
import type { TeamNameSummary } from "@loomcycle/client";
import type { ChunkRow, DocRow } from "../../lib/workflowApi";
import WorkflowTree from "./WorkflowTree";
import TeamDiagramPanel from "./TeamDiagramPanel";
import Splitter from "./Splitter";

// Left panel: pick a board Document, navigate its chunk TREE (select a section,
// drag its child tasks onto the board), and bind a TeamDef (the binding is a
// loomboard convention in the board's root-chunk fields). The team's states
// become the board columns. When a board is open the three sections
// (Boards / Document / Team) are divided by horizontal splitters so the user can
// give the tree or the team diagram more room; the Document tree flexes between.
export default function WorkflowLeft({
  width,
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
  highlightState,
}: {
  /** Splitter-controlled panel width (px). */
  width: number;
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
  /** The selected card's status — highlighted in the team diagram. */
  highlightState?: string;
}) {
  // Section heights (px) when the splitter layout is active. The Document tree
  // flexes between them.
  const [boardsH, setBoardsH] = useState(160);
  const [teamH, setTeamH] = useState(260);

  const boardsList = listError ? (
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
  );

  const teamControls = (
    <>
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
      {boundTeam && <TeamDiagramPanel team={boundTeam} highlightState={highlightState} />}
    </>
  );

  // No board yet: the simple stacked layout — Boards fills, Team below. Nothing
  // to balance against a document, so no splitters.
  if (!selectedDocId) {
    return (
      <div className="wf-left" style={{ width }}>
        <div className="wf-left-section" style={{ flex: 1, minHeight: 0 }}>
          <div className="wf-left-title">Boards</div>
          {boardsList}
        </div>
        <div className="wf-left-section">
          <div className="wf-left-title">Team</div>
          {teamControls}
        </div>
      </div>
    );
  }

  return (
    <div className="wf-left wf-left-split" style={{ width }}>
      <div className="wf-left-section wf-left-scroll" style={{ height: boardsH }}>
        <div className="wf-left-title">Boards</div>
        {boardsList}
      </div>
      <Splitter
        orientation="horizontal"
        label="Resize boards section"
        getSize={() => boardsH}
        setSize={setBoardsH}
        min={80}
        max={420}
      />
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
      <Splitter
        orientation="horizontal"
        invert
        label="Resize team section"
        getSize={() => teamH}
        setSize={setTeamH}
        min={120}
        max={560}
      />
      <div className="wf-left-section wf-left-scroll" style={{ height: teamH }}>
        <div className="wf-left-title">Team</div>
        {teamControls}
      </div>
    </div>
  );
}
