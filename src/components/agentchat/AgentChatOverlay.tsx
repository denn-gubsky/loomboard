import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { InterruptRow, LoomcycleClient } from "@loomcycle/client";
import { Chat, type ChatConversation, type Connection } from "../../chat";
import type { RunTile } from "../../lib/runStates";
import type { AgentIdentity } from "../../lib/agentIdentity";
import PendingQuestionBar from "./PendingQuestionBar";

// The enlarge view: a modal that mounts the full <Chat> for the run (history +
// composer + interrupts + stop, for free) recolored to the agent's accent. If
// the run has a pending question, an answer bar sits on top so the user can
// resolve it right here — the tile advertised it, so it must be answerable here.
//
// Known v1 limit: <Chat> reloads history on open but does not re-attach to a live
// run's token stream, so an in-progress turn shows up to "now"; sending/steering
// resumes the live stream. (A re-attach-safe path is a follow-up.)

export interface AgentChatOverlayProps {
  connection: Connection;
  client: LoomcycleClient;
  tile: RunTile;
  identity: AgentIdentity;
  question?: InterruptRow;
  onClose: () => void;
}

export default function AgentChatOverlay({
  connection,
  client,
  tile,
  identity,
  question,
  onClose,
}: AgentChatOverlayProps) {
  const { Icon } = identity;

  // A local, controlled conversation built from the run — portfolio runs aren't
  // in the conversation store, so we hold the patches <Chat> emits ourselves.
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accentStyle = { "--accent": identity.color } as CSSProperties;

  return (
    <div className="aco-backdrop" onClick={onClose}>
      <div
        className="aco-panel"
        style={accentStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${tile.agent} chat`}
      >
        <header className="aco-head">
          <span className="aco-avatar" style={{ color: identity.color }} aria-hidden>
            <Icon size={16} />
          </span>
          <span className="aco-title">{tile.agent}</span>
          <span className="aco-status">{tile.status}</span>
          <button className="aco-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {question && (
          <PendingQuestionBar client={client} runId={tile.runId} row={question} />
        )}

        <div className="aco-chat">
          <Chat
            connection={connection}
            conversation={conv}
            onConversationChange={onConversationChange}
            style={accentStyle}
          />
        </div>
      </div>
    </div>
  );
}
