import { useEffect, useState } from "react";
import {
  Brain,
  FolderTree,
  LayoutGrid,
  Library as LibraryIcon,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Share2,
  ShieldCheck,
  UserCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useConnection } from "../state/connection";
import { accessSummary, tokenKindLabel, type GatedView } from "../lib/capabilities";
import { useTheme } from "../hooks/useTheme";
import NewChatButton from "./NewChatButton";
import ConversationList from "./ConversationList";
// The wordmark ships in two fills (dark UI wants the white one, light the black);
// the square mark stands in when the rail is collapsed to icon width.
import logoWhite from "../assets/loomboard-logo-white.svg";
import logoBlack from "../assets/loomboard-logo-black.svg";
import brandMark from "../assets/loomboard-favicon.svg";

/** Chats and My access are open to everyone; the rest are gated. */
export type SidebarView = "chat" | "access" | GatedView;

interface Props {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

const GATED: { view: GatedView; label: string; title: string; Icon: LucideIcon }[] = [
  { view: "library", label: "Library", title: "Library", Icon: LibraryIcon },
  { view: "documents", label: "Documents", title: "Documents", Icon: FolderTree },
  { view: "memory", label: "Memory", title: "Memory", Icon: Brain },
  { view: "boards", label: "Boards", title: "Boards", Icon: LayoutGrid },
  { view: "workflow", label: "Workflow", title: "Workflow", Icon: Workflow },
  { view: "canvas", label: "Canvas", title: "Canvas — edit a team's workflow graph", Icon: Share2 },
  { view: "users", label: "Approvals", title: "Approvals — people waiting to be let in", Icon: UserCheck },
];

const COLLAPSE_KEY = "loomboard.sidebarCollapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Sidebar({ view, onViewChange }: Props) {
  const { principal, capabilities, disconnect, signIn } = useConnection();
  const { theme, toggle } = useTheme();
  // Read synchronously on first render so there's no expand→collapse flash.
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  // Log out is one click away from wiping the stored bearer, and the only way
  // back is re-pasting a token the user may not have to hand — so it confirms.
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  // Escape closes the confirmation. Bound to the document, not the card: clicking
  // the card's text moves focus off the buttons, and a handler on the card only
  // sees keys from inside it.
  useEffect(() => {
    if (!confirmingLogout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmingLogout(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmingLogout]);

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
        {/* Only the views loomcycle says this principal can reach: the rest
            would only get 403s. */}
        {GATED.filter((g) => capabilities.views[g.view]).map(({ view: v, label, title, Icon }) => (
          <button
            key={v}
            className={view === v ? "side-nav-btn active" : "side-nav-btn"}
            onClick={() => onViewChange(v)}
            title={title}
          >
            <Icon size={16} /> <span className="label">{label}</span>
          </button>
        ))}
        <button
          className={view === "access" ? "side-nav-btn active" : "side-nav-btn"}
          onClick={() => onViewChange("access")}
          title="My access — how you are connected and what your access rules allow"
        >
          <ShieldCheck size={16} /> <span className="label">My access</span>
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
          <div className="who" title={accessSummary(principal, signIn !== null)}>
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
          onClick={() => setConfirmingLogout(true)}
          title="Log out"
          aria-label="Log out"
          aria-expanded={confirmingLogout}
        >
          <LogOut size={15} />
        </button>

        {confirmingLogout && (
          <div className="logout-confirm" role="dialog" aria-label="Confirm log out">
            <p className="logout-confirm-title">Log out?</p>
            <p className="logout-confirm-note">
              {signIn
                ? "This ends loomboard's sign-in on loomcycle — your loomcycle web session is not affected."
                : "This clears the saved connection — you'll need your loomcycle token to sign back in."}
            </p>
            <div className="logout-confirm-actions">
              {/* Cancel takes focus: on a destructive prompt, a stray Enter should
                  back out, not commit. */}
              <button
                type="button"
                className="btn-ghost sm"
                autoFocus
                onClick={() => setConfirmingLogout(false)}
              >
                Cancel
              </button>
              <button type="button" className="logout-confirm-go" onClick={disconnect}>
                Log out
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
