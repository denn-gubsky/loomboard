import { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Library } from "@loomcycle/library";
import { PathExplorer } from "@loomcycle/explorer";
import { MemoryView } from "@loomcycle/memory-view";
import { Loomboard } from "@loomcycle/loomboard";
import { ConnectionProvider, useConnection } from "./state/connection";
import {
  ConversationsProvider,
  useConversations,
  type Conversation,
} from "./state/conversations";
import { ActiveChatProvider, useActiveChat } from "./state/activeChat";
import type { Connection } from "./chat/lib/createClient";
import { buildConnection } from "./lib/buildConnection";
import { getClient } from "./lib/loomcycle";
import ConnectionSettings from "./components/ConnectionSettings";
import Sidebar from "./components/Sidebar";
import Chat from "./chat/Chat";
import AgentPortfolioGrid from "./components/agentchat/AgentPortfolioGrid";
import WorkflowArea from "./components/workflow/WorkflowArea";

function ChatArea() {
  const { settings } = useConnection();
  const { conversations, active, update } = useConversations();
  const { setStatus, recap } = useActiveChat();
  // Agents the user has run before — suggestions for the picker's free-text
  // fallback when the agent library can't be listed (a user token).
  const knownAgents = useMemo(
    () => Array.from(new Set(conversations.map((c) => c.baseAgent).filter(Boolean))),
    [conversations],
  );
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings) : null),
    [settings],
  );
  const activeId = active?.id;
  const onConversationChange = useCallback(
    (patch: Partial<Conversation>) => {
      if (activeId) update(activeId, patch);
    },
    [activeId, update],
  );

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
    <Chat
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
    />
  );
}

// The loomcycle Library (agent defs / skills / MCP management) mounted in the
// main pane, where the list + lineage + modals have room. It reuses the app's
// connection (dev-proxy fetch included) and principal; theme is inherited from
// <html> data-theme.
function LibraryArea() {
  const { settings, principal } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings) : null),
    [settings],
  );
  if (!connection) return null;
  return (
    <section className="library-pane">
      <Library
        connection={connection}
        principal={principal ?? undefined}
        tabs={["agents", "skills", "mcp"]}
        onError={(e) => console.error("[library]", e)}
      />
    </section>
  );
}

// The Path VFS + chunked-graph Document explorer (@loomcycle/explorer). Same
// connection/principal seam as the Library. Documents need SQL Memory enabled
// server-side; when it's off the component surfaces the refusal via onError.
function DocumentsArea() {
  const { settings, principal } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings) : null),
    [settings],
  );
  if (!connection) return null;
  return (
    <section className="explorer-pane">
      <PathExplorer
        connection={connection}
        principal={principal ?? undefined}
        onError={(e) => console.error("[explorer]", e)}
      />
    </section>
  );
}

// The off-run Memory console (@loomcycle/memory-view): k/v entries, bi-temporal
// facts, and semantic search. Same connection seam; its own scoped styles.
function MemoryArea() {
  const { settings } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings) : null),
    [settings],
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
function BoardsArea() {
  const { settings } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings) : null),
    [settings],
  );
  if (!connection) return null;
  return (
    <section className="boards-pane">
      <Loomboard connection={connection} onError={(e) => console.error("[loomboard]", e)} />
    </section>
  );
}

// Live agent-run portfolio grid (compact tiles + enlarge overlay). A dev-only
// verification harness for the agent-chat-tile component — NOT product nav; the
// RFC AC board will place these tiles. Mount with `?board` in a dev build.
function BoardArea() {
  const { settings, principal } = useConnection();
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings) : null),
    [settings],
  );
  if (!connection || !settings || !principal) return null;
  return (
    <AgentPortfolioGrid
      client={getClient(settings)}
      connection={connection}
      userId={principal.subject}
    />
  );
}

// Connected app: a left rail that switches the main pane between the chat
// surface and the Library.
function AppShell() {
  const { capabilities } = useConnection();
  const [view, setView] = useState<
    "chat" | "library" | "documents" | "memory" | "boards" | "workflow"
  >("chat");
  // Dev-only preview of the agent-tile board via `?board` — no nav entry yet.
  const devBoard =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("board");
  // Library, Documents, Memory, Boards and Workflow are all substrate:tenant
  // surfaces — a user token can't open them (the nav is hidden too), so fall back
  // to chat rather than render a wall of 403s.
  const showLibrary = view === "library" && capabilities.canTenant;
  const showDocuments = view === "documents" && capabilities.canTenant;
  const showMemory = view === "memory" && capabilities.canTenant;
  const showBoards = view === "boards" && capabilities.canTenant;
  const showWorkflow = view === "workflow" && capabilities.canTenant;
  return (
    <ConversationsProvider>
      <ActiveChatProvider>
        <div className="app-shell">
          <Sidebar view={view} onViewChange={setView} />
          {devBoard ? (
            <BoardArea />
          ) : showLibrary ? (
            <LibraryArea />
          ) : showDocuments ? (
            <DocumentsArea />
          ) : showMemory ? (
            <MemoryArea />
          ) : showBoards ? (
            <BoardsArea />
          ) : showWorkflow ? (
            <WorkflowArea />
          ) : (
            <ChatArea />
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
