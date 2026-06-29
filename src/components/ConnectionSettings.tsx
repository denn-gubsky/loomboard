import { useState, type FormEvent } from "react";
import { Plug, Loader2, AlertCircle } from "lucide-react";
import { useConnection } from "../state/connection";

// The connection / login screen. Collects the loomcycle base URL + bearer
// token, validates them with whoami(), and gates the rest of the app. Shown
// whenever we are not in the "connected" state.
export default function ConnectionSettings() {
  const { settings, status, error, connect } = useConnection();
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? "");
  const [token, setToken] = useState(settings?.token ?? "");

  const connecting = status === "connecting";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (connecting) return;
    void connect({ baseUrl: baseUrl.trim(), token: token.trim() });
  }

  return (
    <div className="connect-screen">
      <form className="connect-card" onSubmit={onSubmit}>
        <div className="connect-head">
          <Plug size={22} />
          <h1>Connect to loomcycle</h1>
        </div>
        <p className="connect-sub">
          loomboard is a thin client over a loomcycle runtime. Point it at your
          runtime and authenticate with its bearer token.
        </p>

        <label className="field">
          <span>Base URL</span>
          <input
            type="text"
            inputMode="url"
            placeholder="http://truenas.local:8787 — blank = local default"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <small>
            Any reachable loomcycle (local, a LAN box like TrueNAS, or remote).
            In dev it's reached through the proxy — no CORS needed. Blank ={" "}
            <code>http://127.0.0.1:8787</code>.
          </small>
        </label>

        <label className="field">
          <span>Bearer token</span>
          <input
            type="password"
            placeholder="LOOMCYCLE_AUTH_TOKEN (blank if open mode)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <small>Stored in this browser only. Leave blank if the runtime has no auth.</small>
        </label>

        {status === "error" && error && (
          <div className="connect-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={connecting}>
          {connecting ? (
            <>
              <Loader2 size={16} className="spin" /> Connecting…
            </>
          ) : (
            "Connect"
          )}
        </button>
      </form>
    </div>
  );
}
