import { Plus } from "lucide-react";
import { useConversations } from "../state/conversations";

export default function NewChatButton() {
  const { create } = useConversations();
  return (
    <button className="new-chat" onClick={() => create()} title="New chat">
      <Plus size={16} /> <span className="label">New chat</span>
    </button>
  );
}
