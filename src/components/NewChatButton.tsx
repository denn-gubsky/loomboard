import { Plus } from "lucide-react";
import { useConversations } from "../state/conversations";

export default function NewChatButton() {
  const { create } = useConversations();
  return (
    <button className="new-chat" onClick={() => create()}>
      <Plus size={16} /> New chat
    </button>
  );
}
