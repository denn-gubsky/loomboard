import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Library } from "@loomcycle/library";
import { MemoryView } from "@loomcycle/memory-view";
import { Loomboard, type BoardScope, type SavedView } from "@loomcycle/loomboard";
import { ConnectionProvider, useConnection } from "./state/connection";
import { serverCapabilities } from "./lib/capabilities";
import {
  ConversationsProvider,
  useConversations,
  type Conversation,
} from "./state/conversations";
import { ActiveChatProvider, useActiveChat } from "./state/activeChat";
import type { Connection } from "./chat/lib/createClient";
import { buildConnection } from "./lib/buildConnection";
import { isChatAgent } from "./lib/chatIndex";
import { getClient } from "./lib/loomcycle";
import ConnectionSettings from "./components/ConnectionSettings";
import DocumentsArea, { type DocTarget, type StarView } from "./components/DocumentsArea";
import DocSidePanel from "./components/DocSidePanel";
import Splitter from "./components/workflow/Splitter";
import type { DocumentOpenTarget } from "./chat";
import Sidebar, { type SidebarView } from "./components/Sidebar";
import Chat from "./chat/Chat";
import AgentPortfolioGrid from "./components/agentchat/AgentPortfolioGrid";
import WorkflowArea from "./components/workflow/WorkflowArea";
import CanvasArea from "./components/workflow/CanvasArea";
import PendingApprovals from "./components/PendingApprovals";
import MyAccess from "./components/MyAccess";
import AppClients from "./components/AppClients";
import { appVoice } from "./lib/voice";

// The linked-document panel beside the chat: its width is the reader's own,
// kept between sessions; the chat keeps at least CHAT_MIN.
const DOC_PANEL_KEY = "loomboard.docPanelWidth";
const DOC_PANEL_MIN = 320;
const CHAT_MIN = 360;

function initialDocPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(DOC_PANEL_KEY));
    if (saved >= DOC_PANEL_MIN) return saved;
  } catch {
    // storage blocked: fall through to the default
  }
  return Math.max(DOC_PANEL_MIN, Math.round(window.innerWidth * 0.45));
}

function ChatArea({ onOpenInDocuments }: { onOpenInDocuments?: (t: DocTarget) => void }) {
  const { settings, principal, signIn, capabilities } = useConnection();
  const { conversations, active, update } = useConversations();
  const { setStatus, recap, showAllAgents } = useActiveChat();
  // Agents the user has run before — suggestions for the picker's free-text
  // fallback when the agent library can't be listed (a user token).
  const knownAgents = useMemo(
    () => Array.from(new Set(conversations.map((c) => c.baseAgent).filter(Boolean))),
    [conversations],
  );
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings, signIn) : null),
    [settings, signIn],
  );
  const activeId = active?.id;
  const onConversationChange = useCallback(
    (patch: Partial<Conversation>) => {
      if (activeId) update(activeId, patch);
    },
    [activeId, update],
  );
  // The document a link in this chat opened. Tied to the conversation, so
  // switching chats closes it.
  const [linked, setLinked] = useState<{ chatId: string; target: DocumentOpenTarget }>();
  const openLinked = useCallback(
    (target: DocumentOpenTarget) => {
      if (activeId) setLinked({ chatId: activeId, target });
    },
    [activeId],
  );
  const shown = linked && linked.chatId === activeId ? linked.target : undefined;
  const [panelWidth, setPanelWidth] = useState(initialDocPanelWidth);
  useEffect(() => {
    try {
      localStorage.setItem(DOC_PANEL_KEY, String(panelWidth));
    } catch {
      // storage blocked: the width lasts for this session only
    }
  }, [panelWidth]);
  const paneRef = useRef<HTMLDivElement>(null);

  if (!connection) return null;
  if (!active) {
    return (
      <section className="chat-pane empty">
        <div className="chat-empty">
          <h2>loomboard</h2>
          <p>Start a new chat or pick one from the sidebar.</p>
        </div>
      </section>
    );
  }
  return (
    // Always this wrapper, panel or not: the chat must keep its place in the
    // tree when a document opens beside it, or it remounts and drops the turn
    // it is streaming.
    <div className="chat-split-pane" ref={paneRef}>
      <div className="chat-split-pane__chat">
        <Chat
          voice={appVoice}
          // Remount per conversation: a fresh useChat per chat tears the previous
          // run down cleanly. Without this the one reused instance leaks the prior
          // chat's session/run onto the newly-selected conversation (the persist
          // effect fires with the old state but the new conversation). Mirrors the
          // extension's PanelApp, which keys <Chat> for the same reason.
          key={active.id}
          connection={connection}
          conversation={active}
          onConversationChange={onConversationChange}
          onRunStatus={setStatus}
          recap={recap ?? undefined}
          knownAgents={knownAgents}
          // The sidebar's "All agents" box widens the picker with the list.
          agentFilter={showAllAgents ? undefined : isChatAgent}
          // Same gate as the canvas's "Open in Documents": a principal who
          // cannot read Documents gets previews only.
          onOpenDocument={capabilities.views.documents ? openLinked : undefined}
        />
      </div>
      {shown && (
        <>
          <Splitter
            getSize={() => panelWidth}
            setSize={setPanelWidth}
            min={DOC_PANEL_MIN}
            max={Math.max(DOC_PANEL_MIN, (paneRef.current?.clientWidth ?? window.innerWidth) - CHAT_MIN)}
            invert
            label="Resize the document panel"
          />
          <DocSidePanel
            connection={connection}
            principal={principal ?? undefined}
            target={shown}
            width={panelWidth}
            onClose={() => setLinked(undefined)}
            onOpenInDocuments={onOpenInDocuments && (() => onOpenInDocuments(shown))}
          />
        </>
      )}
    </div>
  );
}

// The loomcycle Library (agent defs / skills / MCP management) mounted in the
// main pane, where the list + lineage + modals have room. It reuses the app's
// connection (dev-proxy fetch included) and principal; theme is inherited from
// <html> data-theme.
function LibraryArea() {
  const { settings, principal, signIn } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings, signIn) : null),
    [settings, signIn],
  );
  if (!connection) return null;
  return (
    <section className="library-pane">
      <Library
        connection={connection}
        principal={principal ?? undefined}
        // Runtime posture from whoami (RFC AU). Without it the MCP tab pins its
        // stdio-import gate closed and drops the http-allowlist warning, so the
        // tab silently under-reports what this runtime actually allows.
        serverCapabilities={serverCapabilities(principal)}
        tabs={["agents", "skills", "mcp"]}
        onError={(e) => console.error("[library]", e)}
      />
    </section>
  );
}

// The off-run Memory console (@loomcycle/memory-view): k/v entries, bi-temporal
// facts, and semantic search. Same connection seam; its own scoped styles.
function MemoryArea() {
  const { settings, signIn } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings, signIn) : null),
    [settings, signIn],
  );
  if (!connection) return null;
  return (
    <section className="memory-pane">
      <MemoryView connection={connection} />
    </section>
  );
}

// The RFC BT view layer (@loomcycle/loomboard): saved table / cards / kanban /
// list views over loomcycle Documents. Same connection seam; its own scoped
// styles. Boards persist as `type=view` Documents in the user/tenant scope.
function BoardsArea({ onOpenUniverse }: { onOpenUniverse?: (view: SavedView, scope: BoardScope) => void }) {
  const { settings, signIn } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings, signIn) : null),
    [settings, signIn],
  );
  if (!connection) return null;
  return (
    <section className="boards-pane">
      <Loomboard
        connection={connection}
        // A view saved from the star map (layout kind "universe") gets an
        // "Open in the star map" button that lands in Documents → stars.
        onOpenUniverse={onOpenUniverse}
        onError={(e) => console.error("[loomboard]", e)}
      />
    </section>
  );
}

// Live agent-run portfolio grid (compact tiles + enlarge overlay). A dev-only
// verification harness for the agent-chat-tile component — NOT product nav; the
// RFC AC board will place these tiles. Mount with `?board` in a dev build.
function BoardArea() {
  const { settings, principal, signIn } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings, signIn) : null),
    [settings, signIn],
  );
  if (!connection || !settings || !principal) return null;
  return (
    <AgentPortfolioGrid
      client={getClient(settings, signIn)}
      connection={connection}
      userId={principal.subject}
    />
  );
}

// Connected app: a left rail that switches the main pane between the chat
// surface and the Library.
function AppShell() {
  const { capabilities } = useConnection();
  const [view, setView] = useState<SidebarView>("chat");
  // A document the canvas asked the Documents view to show. Picking any view
  // from the rail drops it, so Documents opens on the explorer as usual.
  const [docTarget, setDocTarget] = useState<DocTarget>();
  // A saved star-map view Boards asked the Documents view to open. Same
  // lifetime as docTarget: any pick from the rail drops it.
  const [starView, setStarView] = useState<StarView>();
  const changeView = useCallback((v: SidebarView) => {
    setDocTarget(undefined);
    setStarView(undefined);
    setView(v);
  }, []);
  const openDocument = useCallback((t: DocTarget) => {
    setDocTarget(t);
    setView("documents");
  }, []);
  const openStarView = useCallback((view: SavedView, scope: BoardScope) => {
    setStarView({ viewId: view.documentId, scope });
    setView("documents");
  }, []);
  // Dev-only preview of the agent-tile board via `?board` — no nav entry yet.
  const devBoard =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("board");
  // A view the principal cannot reach (its nav entry is hidden too) falls back
  // to chat rather than render a wall of 403s.
  const shown: SidebarView =
    view === "chat" || view === "access" || capabilities.views[view] ? view : "chat";
  return (
    <ConversationsProvider>
      <ActiveChatProvider>
        <div className="app-shell">
          <Sidebar view={shown} onViewChange={changeView} />
          {devBoard ? (
            <BoardArea />
          ) : shown === "library" ? (
            <LibraryArea />
          ) : shown === "documents" ? (
            <DocumentsArea target={docTarget} starView={starView} onClearTarget={() => setDocTarget(undefined)} />
          ) : shown === "memory" ? (
            <MemoryArea />
          ) : shown === "boards" ? (
            <BoardsArea onOpenUniverse={capabilities.views.documents ? openStarView : undefined} />
          ) : shown === "workflow" ? (
            <WorkflowArea />
          ) : shown === "canvas" ? (
            <CanvasArea onOpenDocument={capabilities.views.documents ? openDocument : undefined} />
          ) : shown === "users" ? (
            <PendingApprovals />
          ) : shown === "apps" ? (
            <AppClients />
          ) : shown === "access" ? (
            <MyAccess />
          ) : (
            <ChatArea onOpenInDocuments={capabilities.views.documents ? openDocument : undefined} />
          )}
        </div>
      </ActiveChatProvider>
    </ConversationsProvider>
  );
}

function Shell() {
  const { status } = useConnection();

  if (status === "connecting") {
    return (
      <div className="splash">
        <Loader2 className="spin" size={22} />
        <span>Connecting to loomcycle…</span>
      </div>
    );
  }

  if (status !== "connected") {
    return <ConnectionSettings />;
  }

  return <AppShell />;
}

export default function App() {
  return (
    <ConnectionProvider>
      <Shell />
    </ConnectionProvider>
  );
}
