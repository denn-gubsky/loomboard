import { useMemo } from "react";
import { Check, Trash2, X } from "lucide-react";
import type { InterruptRow, LoomcycleClient } from "@loomcycle/client";
import type { Conversation } from "../../state/conversations";
import { agentIdentity } from "../../lib/agentIdentity";
import { tileDisplayState, type RunTile } from "../../lib/runStates";
import { useInView, useTilePreview } from "../../hooks/useTilePreview";
import AgentChatTile from "./AgentChatTile";

// A minimized view of one of the user's chats for the sidebar: identity from the
// conversation's agent, live state joined from the aggregate run-state feed
// (by runId) + pending question, and an in-view-gated transcript preview. Click
// selects it (the main pane expands it). Delete keeps the list's two-step confirm.
export default function ConversationTile({
  conversation,
  client,
  collapsed,
  runState,
  question,
  active,
  confirming,
  onSelect,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  conversation: Conversation;
  client: LoomcycleClient;
  collapsed: boolean;
  runState?: RunTile;
  question?: InterruptRow;
  active: boolean;
  confirming: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const name = conversation.baseAgent || conversation.title || "New chat";
  const identity = useMemo(
    () => agentIdentity(conversation.baseAgent || conversation.title || conversation.id),
    [conversation.baseAgent, conversation.title, conversation.id],
  );

  const [ref, inView] = useInView<HTMLDivElement>();
  // Refetch the preview when the run transitions; string key so a not-started
  // chat (no runState) still has a stable key.
  const refreshKey = runState?.ts ?? String(conversation.updatedAt);
  const { lines, loading } = useTilePreview(
    client,
    conversation.sessionId,
    refreshKey,
    inView && !collapsed,
    2,
  );

  const state = runState ? tileDisplayState(runState, Boolean(question)) : "idle";
  const alert =
    runState?.status === "failed" ? runState.error || "run failed" : undefined;

  if (collapsed) {
    const { Icon } = identity;
    return (
      <button
        type="button"
        className={active ? "convtile-mini active" : "convtile-mini"}
        style={{ ["--tile-accent" as string]: identity.color }}
        onClick={onSelect}
        title={name}
      >
        <span className="act-avatar" aria-hidden>
          <Icon size={16} />
        </span>
        <span className={`act-dot dot-${state}`} aria-hidden />
        {(question || alert) && <span className="convtile-mini-flag" aria-hidden />}
      </button>
    );
  }

  return (
    <div ref={ref} className={active ? "convtile active" : "convtile"}>
      <AgentChatTile
        agentName={name}
        Icon={identity.Icon}
        accentColor={identity.color}
        state={state}
        preview={lines}
        loadingPreview={loading && lines.length === 0}
        alert={alert}
        question={question ? question.question || "The agent is asking for input." : undefined}
        questionPriority={question?.priority}
        onOpen={onSelect}
      />
      {confirming ? (
        <span className="convtile-confirm">
          <button
            className="convtile-del confirm"
            title="Confirm delete"
            aria-label="Confirm delete"
            onClick={(e) => {
              e.stopPropagation();
              onConfirmDelete();
            }}
          >
            <Check size={13} />
          </button>
          <button
            className="convtile-del cancel"
            title="Cancel"
            aria-label="Cancel delete"
            onClick={(e) => {
              e.stopPropagation();
              onCancelDelete();
            }}
          >
            <X size={13} />
          </button>
        </span>
      ) : (
        <button
          className="convtile-del"
          title="Delete conversation"
          aria-label="Delete conversation"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
