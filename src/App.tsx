import { Loader2 } from "lucide-react";
import { ConnectionProvider, useConnection } from "./state/connection";
import { ConversationsProvider } from "./state/conversations";
import ConnectionSettings from "./components/ConnectionSettings";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";

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
        <ChatPane />
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
