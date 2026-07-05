import { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Library } from "@loomcycle/library";
import { ConnectionProvider, useConnection } from "./state/connection";
import {
  ConversationsProvider,
  useConversations,
  type Conversation,
} from "./state/conversations";
import type { Connection } from "./chat/lib/createClient";
import type { ConnectionSettings as ConnSettings } from "./state/settings";
import { isTauri, proxyMode } from "./lib/proxyMode";
import { getNativeFetch } from "./lib/nativeTransport";
import ConnectionSettings from "./components/ConnectionSettings";
import Sidebar from "./components/Sidebar";
import Chat from "./chat/Chat";

// Turn the app's connection settings into the <Chat> connection. In proxy mode
// (dev server or the standalone CLI) we route through a same-origin proxy
// (same-origin + a per-request target header) so any reachable runtime works
// with no CORS; a plain production build hits the base URL directly. This proxy
// detail is the APP's concern — the component just takes a Connection.
function buildConnection(s: ConnSettings): Connection {
  if (isTauri) {
    // Desktop: hit the absolute loomcycle URL directly via native HTTP (Rust),
    // which bypasses webview CORS. getNativeFetch() is a stable singleton so
    // <Chat>'s client memo (keyed on connection.fetch) doesn't churn. Blank URL
    // → the same local default the CLI uses.
    return {
      baseUrl: s.baseUrl || "http://127.0.0.1:8787",
      token: s.token,
      fetch: getNativeFetch(),
    };
  }
  if (proxyMode) {
    const target = s.baseUrl;
    return {
      baseUrl: "",
      token: s.token,
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (target) headers.set("x-loomcycle-target", target);
        return fetch(input, { ...init, headers });
      },
    };
  }
  return { baseUrl: s.baseUrl, token: s.token };
}

function ChatArea() {
  const { settings } = useConnection();
  const { active, update } = useConversations();
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
      connection={connection}
      conversation={active}
      onConversationChange={onConversationChange}
    />
  );
}

// The loomcycle Library (skills / MCP management) mounted in the main pane,
// where the list + lineage + modals have room. It reuses the app's connection
// (dev-proxy fetch included) and principal; theme is inherited from <html>
// data-theme. Agents management is a later add — extend `tabs` with "agents".
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
        tabs={["skills", "mcp"]}
        onError={(e) => console.error("[library]", e)}
      />
    </section>
  );
}

// Connected app: a left rail that switches the main pane between the chat
// surface and the Library.
function AppShell() {
  const [view, setView] = useState<"chat" | "library">("chat");
  return (
    <ConversationsProvider>
      <div className="app-shell">
        <Sidebar view={view} onViewChange={setView} />
        {view === "library" ? <LibraryArea /> : <ChatArea />}
      </div>
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
