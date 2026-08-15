import { useState } from "react";
import {
  Brain,
  FolderTree,
  Library as LibraryIcon,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Workflow,
} from "lucide-react";
import { useConnection } from "../state/connection";
import { tokenKindLabel } from "../lib/capabilities";
import { useTheme } from "../hooks/useTheme";
import NewChatButton from "./NewChatButton";
import ConversationList from "./ConversationList";
// The wordmark ships in two fills (dark UI wants the white one, light the black);
// the square mark stands in when the rail is collapsed to icon width.
import logoWhite from "../assets/loomboard-logo-white.svg";
import logoBlack from "../assets/loomboard-logo-black.svg";
import brandMark from "../assets/loomboard-favicon.svg";

export type SidebarView = "chat" | "library" | "documents" | "memory" | "workflow";

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
  const { principal, capabilities, disconnect } = useConnection();
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
        {collapsed ? (
          <img className="brand-mark" src={brandMark} alt="loomboard" />
        ) : (
          <img
            className="brand-logo"
            src={theme === "dark" ? logoWhite : logoBlack}
            alt="loomboard"
          />
        )}
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
        {/* Library, Documents and Memory are all substrate:tenant surfaces —
            hide them for a delegated user token, which would only get 403s. */}
        {capabilities.canTenant && (
          <>
            <button
              className={view === "library" ? "side-nav-btn active" : "side-nav-btn"}
              onClick={() => onViewChange("library")}
              title="Library"
            >
              <LibraryIcon size={16} /> <span className="label">Library</span>
            </button>
            <button
              className={
                view === "documents" ? "side-nav-btn active" : "side-nav-btn"
              }
              onClick={() => onViewChange("documents")}
              title="Documents"
            >
              <FolderTree size={16} /> <span className="label">Documents</span>
            </button>
            <button
              className={view === "memory" ? "side-nav-btn active" : "side-nav-btn"}
              onClick={() => onViewChange("memory")}
              title="Memory"
            >
              <Brain size={16} /> <span className="label">Memory</span>
            </button>
            <button
              className={view === "workflow" ? "side-nav-btn active" : "side-nav-btn"}
              onClick={() => onViewChange("workflow")}
              title="Workflow"
            >
              <Workflow size={16} /> <span className="label">Workflow</span>
            </button>
          </>
        )}
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
            <strong>
              {principal?.subject ?? "—"}
              {tokenKindLabel(principal) && (
                <span className="who-kind">{tokenKindLabel(principal)}</span>
              )}
            </strong>
            <span>{principal?.tenant_id}</span>
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
