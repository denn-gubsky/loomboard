import { useState } from "react";
import { Check, MessageSquare, Trash2, X } from "lucide-react";
import { useConversations, type Conversation } from "../state/conversations";
import { useLoomcycle } from "../state/connection";
import { deleteConversationAgent } from "../chat/lib/agentFork";

export default function ConversationList() {
  const { conversations, activeId, select, remove } = useConversations();
  const client = useLoomcycle();
  // Deletion is destructive and the trash icon sits right on the row (easy to
  // mis-hit), so it's a two-step inline confirm. We do NOT use window.confirm:
  // Tauri webviews don't implement the synchronous JS dialogs, so it silently
  // returns false there and deletion never fires. This works everywhere.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function doDelete(c: Conversation) {
    // Clean up the conversation's private derived agent, if any (best-effort).
    if (c.forkDefName) void deleteConversationAgent(client, c.forkDefName);
    remove(c.id);
    setConfirmingId(null);
  }

  if (conversations.length === 0) {
    return <p className="convo-empty">No conversations yet.</p>;
  }

  // Newest activity first.
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <ul className="convo-list">
      {sorted.map((c) => (
        <li
          key={c.id}
          className={c.id === activeId ? "convo active" : "convo"}
          // Clicking a row cancels any pending confirm and selects it.
          onClick={() => {
            setConfirmingId(null);
            select(c.id);
          }}
          title={c.title}
        >
          <MessageSquare size={15} className="convo-icon" />
          <span className="convo-title">{c.title}</span>
          {c.baseAgent && <span className="convo-agent">{c.baseAgent}</span>}
          {confirmingId === c.id ? (
            <span className="convo-confirm">
              <button
                className="convo-del confirm"
                title="Confirm delete"
                aria-label="Confirm delete"
                onClick={(e) => {
                  e.stopPropagation();
                  doDelete(c);
                }}
              >
                <Check size={14} />
              </button>
              <button
                className="convo-del cancel"
                title="Cancel"
                aria-label="Cancel delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingId(null);
                }}
              >
                <X size={14} />
              </button>
            </span>
          ) : (
            <button
              className="convo-del"
              title="Delete conversation"
              aria-label="Delete conversation"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingId(c.id);
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
