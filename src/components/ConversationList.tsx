import { MessageSquare, Trash2 } from "lucide-react";
import { useConversations, type Conversation } from "../state/conversations";
import { useLoomcycle } from "../state/connection";
import { deleteConversationAgent } from "../lib/agentFork";

export default function ConversationList() {
  const { conversations, activeId, select, remove } = useConversations();
  const client = useLoomcycle();

  function onDelete(c: Conversation) {
    // Clean up the conversation's private derived agent, if any (best-effort).
    if (c.forkDefName) void deleteConversationAgent(client, c.forkDefName);
    remove(c.id);
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
          onClick={() => select(c.id)}
          title={c.title}
        >
          <MessageSquare size={15} className="convo-icon" />
          <span className="convo-title">{c.title}</span>
          {c.baseAgent && <span className="convo-agent">{c.baseAgent}</span>}
          <button
            className="convo-del"
            title="Delete conversation"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(c);
            }}
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
