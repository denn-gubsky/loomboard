import { useState, type FormEvent } from "react";
import { Plug, Loader2, AlertCircle } from "lucide-react";
import type { ConnectionSettings } from "../state/settings";

interface Props {
  onConnect: (s: ConnectionSettings) => void;
  error: string | null;
  initial: ConnectionSettings | null;
}

// A Chrome host match pattern for the loomcycle origin. Match patterns ignore the
// port (they match all ports on the host), so we use scheme + hostname + "/*".
function hostPattern(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

// Connection / login screen for the side panel. Collects the loomcycle base URL +
// bearer, requests host access for that origin (in this click gesture, required
// so the panel's fetch can reach loomcycle), then hands validation to PanelApp.
export default function Connect({ onConnect, error, initial }: Props) {
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [token, setToken] = useState(initial?.token ?? "");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setLocalError(null);
    const url = baseUrl.trim();
    const pattern = hostPattern(url);
    if (!pattern) {
      setLocalError("Enter a valid http(s) URL, e.g. https://host:8788");
      return;
    }
    setBusy(true);
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        setLocalError("Host permission is required to reach loomcycle.");
        setBusy(false);
        return;
      }
    } catch {
      setLocalError("Could not request host permission.");
      setBusy(false);
      return;
    }
    onConnect({ baseUrl: url, token: token.trim() });
  }

  const shown = localError ?? error;

  return (
    <div className="connect-screen">
      <form className="connect-card" onSubmit={onSubmit}>
        <div className="connect-head">
          <Plug size={22} />
          <h1>Connect to loomcycle</h1>
        </div>
        <p className="connect-sub">
          The loomboard assistant runs on your loomcycle runtime. Point it at your
          runtime and authenticate with its bearer token.
        </p>

        <label className="field">
          <span>Base URL</span>
          <input
            type="text"
            inputMode="url"
            placeholder="https://host:8788"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <small>
            The extension connects directly; host access is requested when you
            connect.
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
          <small>Stored in this browser's extension storage only.</small>
        </label>

        {shown && (
          <div className="connect-error" role="alert">
            <AlertCircle size={16} />
            <span>{shown}</span>
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? (
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
