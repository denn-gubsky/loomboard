import { MessageSquare, Trash2 } from "lucide-react";
import { useConversations } from "../state/conversations";

export default function ConversationList() {
  const { conversations, activeId, select, remove } = useConversations();

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
        >
          <MessageSquare size={15} className="convo-icon" />
          <span className="convo-title">{c.title}</span>
          {c.baseAgent && <span className="convo-agent">{c.baseAgent}</span>}
          <button
            className="convo-del"
            title="Delete conversation"
            onClick={(e) => {
              e.stopPropagation();
              remove(c.id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
