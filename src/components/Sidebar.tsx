import { useState } from "react";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useConnection } from "../state/connection";
import NewChatButton from "./NewChatButton";
import ConversationList from "./ConversationList";

const COLLAPSE_KEY = "loomboard.sidebarCollapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Sidebar() {
  const { principal, disconnect } = useConnection();
  // Read synchronously on first render so there's no expand→collapse flash.
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable — collapse just won't persist.
      }
      return next;
    });
  }

  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="sidebar-head">
        {!collapsed && <span className="brand">loomboard</span>}
        <button
          className="btn-ghost sm collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <NewChatButton />
      <ConversationList />

      <div className="sidebar-foot">
        {!collapsed && (
          <div className="who">
            <strong>{principal?.subject ?? "—"}</strong>
            <span>
              {principal?.tenant_id}
              {principal?.open_mode ? " · open" : ""}
            </span>
          </div>
        )}
        <button
          className="btn-ghost sm"
          onClick={disconnect}
          title="Disconnect"
          aria-label="Disconnect"
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
}
