import { useCallback, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { InterruptRow, LoomcycleClient } from "@loomcycle/client";
import { Chat, type ChatConversation, type Connection } from "../../chat";
import { agentIdentity } from "../../lib/agentIdentity";
import PendingQuestionBar from "../agentchat/PendingQuestionBar";

// One chat pane in the dock. A run pane attaches to an existing run (runId +
// sessionId, from a card miniature); the orchestrator pane starts a fresh run
// pre-filled with the board's context (initialInput) for the user to send.
export interface WorkflowPane {
  /** Stable React key, conversation id, and focus id. */
  id: string;
  agent: string;
  runId?: string;
  sessionId?: string;
  /** Seed the composer (orchestrator pane). */
  initialInput?: string;
  /** Status dot until <Chat> reports live state. */
  initialRunning?: boolean;
}

// The right-panel chat dock: on-demand interactive chats for the agents working
// the board (click a card miniature) plus an optional team orchestrator you
// start to drive the board. Panes stack vertically; only the FOCUSED pane owns
// the Escape key (turn-cancel), so one Escape cancels one turn.
export interface WorkflowChatDockProps {
  connection: Connection;
  client: LoomcycleClient;
  /** Splitter-controlled dock width (px). */
  width: number;
  /** Panes to show, in order (orchestrator first, then selected runs). */
  panes: WorkflowPane[];
  /** run id → its pending interruption, for the answer bar (run panes). */
  interrupts: Map<string, InterruptRow>;
  /** Which pane id currently owns Escape (the last one the user touched). */
  focusedId: string | null;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}

export default function WorkflowChatDock({
  connection,
  client,
  width,
  panes,
  interrupts,
  focusedId,
  onFocus,
  onClose,
}: WorkflowChatDockProps) {
  if (panes.length === 0) return null;
  return (
    <aside className="wf-dock" aria-label="Agent chats" style={{ width }}>
      {panes.map((p) => (
        <DockPane
          key={p.id}
          connection={connection}
          client={client}
          pane={p}
          question={p.runId ? interrupts.get(p.runId) : undefined}
          focused={p.id === focusedId}
          onFocus={() => onFocus(p.id)}
          onClose={() => onClose(p.id)}
        />
      ))}
    </aside>
  );
}

function DockPane({
  connection,
  client,
  pane,
  question,
  focused,
  onFocus,
  onClose,
}: {
  connection: Connection;
  client: LoomcycleClient;
  pane: WorkflowPane;
  question?: InterruptRow;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
}) {
  const identity = agentIdentity(pane.agent);
  const { Icon } = identity;

  // A local, controlled conversation — board/orchestrator runs aren't in the
  // conversation store, so we hold the patches <Chat> emits ourselves (the
  // AgentChatOverlay pattern). A fresh orchestrator pane has no run/session yet;
  // <Chat> spawns the run when the user sends the seeded message.
  const [conv, setConv] = useState<ChatConversation>(() => ({
    id: pane.id,
    title: pane.agent,
    baseAgent: pane.agent,
    config: {},
    runId: pane.runId,
    sessionId: pane.sessionId,
  }));
  const onConversationChange = useCallback(
    (patch: Partial<ChatConversation>) => setConv((c) => ({ ...c, ...patch })),
    [],
  );

  // Live status for the header dot — the aggregate run-state feed lags a
  // just-started/just-answered run, so read it from <Chat> directly.
  const [live, setLive] = useState<{ running: boolean; needsInput: boolean }>({
    running: pane.initialRunning ?? false,
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
        <span className="wf-pane-title">{pane.agent}</span>
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

      {question && <PendingQuestionBar client={client} runId={question.run_id} row={question} />}

      <div className="wf-pane-chat">
        <Chat
          connection={connection}
          conversation={conv}
          onConversationChange={onConversationChange}
          onRunStatus={setLive}
          escapeStops={focused}
          initialInput={pane.initialInput}
          style={accentStyle}
        />
      </div>
    </section>
  );
}
