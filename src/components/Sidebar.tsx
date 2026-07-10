import { useState } from "react";
import {
  Library as LibraryIcon,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from "lucide-react";
import { useConnection } from "../state/connection";
import { useTheme } from "../hooks/useTheme";
import NewChatButton from "./NewChatButton";
import ConversationList from "./ConversationList";

export type SidebarView = "chat" | "library";

interface Props {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

const COLLAPSE_KEY = "loomboard.sidebarCollapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Sidebar({ view, onViewChange }: Props) {
  const { principal, disconnect } = useConnection();
  const { theme, toggle } = useTheme();
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

      <nav className="side-nav">
        <button
          className={view === "chat" ? "side-nav-btn active" : "side-nav-btn"}
          onClick={() => onViewChange("chat")}
          title="Chats"
        >
          <MessageSquare size={16} /> <span className="label">Chats</span>
        </button>
        <button
          className={view === "library" ? "side-nav-btn active" : "side-nav-btn"}
          onClick={() => onViewChange("library")}
          title="Library"
        >
          <LibraryIcon size={16} /> <span className="label">Library</span>
        </button>
      </nav>

      {view === "chat" ? (
        <>
          <NewChatButton />
          <ConversationList collapsed={collapsed} />
        </>
      ) : (
        <div className="side-fill" />
      )}

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
          onClick={toggle}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          aria-label="Toggle color theme"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
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
