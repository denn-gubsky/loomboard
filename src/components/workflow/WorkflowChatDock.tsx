import { useCallback, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { InterruptRow, LoomcycleClient } from "@loomcycle/client";
import { Chat, type ChatConversation, type Connection } from "../../chat";
import type { RunTile } from "../../lib/runStates";
import { agentIdentity } from "../../lib/agentIdentity";
import PendingQuestionBar from "../agentchat/PendingQuestionBar";

// The right-panel chat dock: on-demand interactive chats for the agents working
// the board. Selecting a card's agent miniature opens that run's live <Chat>
// here (steer / answer an interruption) while the board stays visible. It hosts
// several panes stacked vertically; only the FOCUSED pane owns the Escape key
// (turn-cancel), so one Escape cancels one turn — not every running pane.
export interface WorkflowChatDockProps {
  connection: Connection;
  client: LoomcycleClient;
  /** The selected runs, in open order — one pane each. */
  runs: RunTile[];
  /** run id → its pending interruption, for the answer bar. */
  interrupts: Map<string, InterruptRow>;
  /** Which pane currently owns Escape (the last one the user touched). */
  focusedRunId: string | null;
  onFocus: (runId: string) => void;
  onClose: (runId: string) => void;
}

export default function WorkflowChatDock({
  connection,
  client,
  runs,
  interrupts,
  focusedRunId,
  onFocus,
  onClose,
}: WorkflowChatDockProps) {
  if (runs.length === 0) return null;
  return (
    <aside className="wf-dock" aria-label="Agent chats">
      {runs.map((t) => (
        <DockPane
          key={t.runId}
          connection={connection}
          client={client}
          tile={t}
          question={interrupts.get(t.runId)}
          focused={t.runId === focusedRunId}
          onFocus={() => onFocus(t.runId)}
          onClose={() => onClose(t.runId)}
        />
      ))}
    </aside>
  );
}

function DockPane({
  connection,
  client,
  tile,
  question,
  focused,
  onFocus,
  onClose,
}: {
  connection: Connection;
  client: LoomcycleClient;
  tile: RunTile;
  question?: InterruptRow;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
}) {
  const identity = agentIdentity(tile.agent);
  const { Icon } = identity;

  // A local, controlled conversation built from the run — board runs aren't in
  // the conversation store, so we hold the patches <Chat> emits ourselves (same
  // pattern as AgentChatOverlay).
  const [conv, setConv] = useState<ChatConversation>(() => ({
    id: tile.runId,
    title: tile.agent,
    baseAgent: tile.agent,
    config: {},
    runId: tile.runId,
    sessionId: tile.sessionId,
  }));
  const onConversationChange = useCallback(
    (patch: Partial<ChatConversation>) => setConv((c) => ({ ...c, ...patch })),
    [],
  );

  // Live status for the header dot — the aggregate run-state feed lags a
  // just-started/just-answered run, so read it from <Chat> directly.
  const [live, setLive] = useState<{ running: boolean; needsInput: boolean }>({
    running: tile.status === "running",
    needsInput: false,
  });
  const dot = live.needsInput ? "needs-input" : live.running ? "running" : "idle";

  const accentStyle = { "--accent": identity.color } as CSSProperties;

  return (
    <section
      className={focused ? "wf-pane focused" : "wf-pane"}
      style={accentStyle}
      onMouseDown={onFocus}
      onFocusCapture={onFocus}
    >
      <header className="wf-pane-head">
        <span className="wf-pane-avatar" style={{ color: identity.color }} aria-hidden>
          <Icon size={15} />
        </span>
        <span className="wf-pane-title">{tile.agent}</span>
        <span className={`wf-pane-dot ${dot}`} title={dot} />
        <button
          className="wf-pane-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close chat"
        >
          <X size={15} />
        </button>
      </header>

      {question && <PendingQuestionBar client={client} runId={tile.runId} row={question} />}

      <div className="wf-pane-chat">
        <Chat
          connection={connection}
          conversation={conv}
          onConversationChange={onConversationChange}
          onRunStatus={setLive}
          escapeStops={focused}
          style={accentStyle}
        />
      </div>
    </section>
  );
}
