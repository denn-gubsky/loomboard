import { useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { ConnectionProvider, useConnection } from "./state/connection";
import {
  ConversationsProvider,
  useConversations,
  type Conversation,
} from "./state/conversations";
import type { Connection } from "./chat/lib/createClient";
import type { ConnectionSettings as ConnSettings } from "./state/settings";
import { proxyMode } from "./lib/proxyMode";
import ConnectionSettings from "./components/ConnectionSettings";
import Sidebar from "./components/Sidebar";
import Chat from "./chat/Chat";

// Turn the app's connection settings into the <Chat> connection. In proxy mode
// (dev server or the standalone CLI) we route through a same-origin proxy
// (same-origin + a per-request target header) so any reachable runtime works
// with no CORS; a plain production build hits the base URL directly. This proxy
// detail is the APP's concern — the component just takes a Connection.
function buildConnection(s: ConnSettings): Connection {
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

  return (
    <ConversationsProvider>
      <div className="app-shell">
        <Sidebar />
        <ChatArea />
      </div>
    </ConversationsProvider>
  );
}

export default function App() {
  return (
    <ConnectionProvider>
      <Shell />
    </ConnectionProvider>
  );
}
