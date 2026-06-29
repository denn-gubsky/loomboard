import { Loader2, LogOut } from "lucide-react";
import { ConnectionProvider, useConnection } from "./state/connection";
import ConnectionSettings from "./components/ConnectionSettings";

function Shell() {
  const { status, principal, settings, disconnect } = useConnection();

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

  // Placeholder home for now — the sidebar + chat surface land in the next
  // steps. Proves the whoami gate works end to end.
  return (
    <div className="app-shell">
      <main className="app-placeholder">
        <h1>loomboard</h1>
        <p>
          Connected to <code>{settings?.baseUrl || "(same origin)"}</code> as{" "}
          <strong>{principal?.subject}</strong>
          {" @ "}
          <strong>{principal?.tenant_id}</strong>
          {principal?.open_mode ? " (open mode)" : ""}.
        </p>
        <button className="btn-ghost" onClick={disconnect}>
          <LogOut size={16} /> Disconnect
        </button>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ConnectionProvider>
      <Shell />
    </ConnectionProvider>
  );
}
