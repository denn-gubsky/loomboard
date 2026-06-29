import { LogOut } from "lucide-react";
import { useConnection } from "../state/connection";
import NewChatButton from "./NewChatButton";
import ConversationList from "./ConversationList";

export default function Sidebar() {
  const { principal, disconnect } = useConnection();

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">loomboard</span>
      </div>

      <NewChatButton />
      <ConversationList />

      <div className="sidebar-foot">
        <div className="who">
          <strong>{principal?.subject ?? "—"}</strong>
          <span>
            {principal?.tenant_id}
            {principal?.open_mode ? " · open" : ""}
          </span>
        </div>
        <button
          className="btn-ghost sm"
          onClick={disconnect}
          title="Disconnect"
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
}
