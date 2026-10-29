import { useState } from "react";
import type { ConnectionSettings } from "../state/settings";
import type { SignInProblemKind } from "../lib/appSignIn";
import { extRedirectUri } from "../lib/extSignIn";
import SignInCard from "../components/SignInCard";

interface Props {
  onConnect: (s: ConnectionSettings) => void;
  onSignIn: (baseUrl: string) => void;
  /** Resume the stored sign-in after loomcycle did not answer. */
  onRetry: () => void;
  busy: boolean;
  error: string | null;
  problem: SignInProblemKind | null;
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

// Connection / sign-in screen for the side panel. Either path first requests
// host access for the loomcycle origin — in this click gesture, which Chrome
// requires, so the panel's fetch can reach loomcycle — then hands off to
// PanelApp: "Sign in with loomcycle" by default, a pasted bearer under Advanced.
export default function Connect({ onConnect, onSignIn, onRetry, busy, error, problem, initial }: Props) {
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  // This install's addresses: the ID differs between a store install and an
  // unpacked one, so the operator registers them per install.
  const redirectUri = extRedirectUri(chrome.identity);
  const origin = window.location.origin;

  async function withHostAccess(then: (url: string) => void) {
    setLocalError(null);
    const url = baseUrl.trim();
    const pattern = hostPattern(url);
    if (!pattern) {
      setLocalError("Enter a valid http(s) URL, e.g. https://host:8788");
      return;
    }
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        setLocalError("Host permission is required to reach loomcycle.");
        return;
      }
    } catch {
      setLocalError("Could not request host permission.");
      return;
    }
    then(url);
  }

  return (
    <SignInCard
      intro="The loomboard assistant runs on your loomcycle runtime. Enter its address, then sign in on loomcycle's own page."
      baseUrl={baseUrl}
      onBaseUrlChange={setBaseUrl}
      baseUrlPlaceholder="https://host:8788"
      baseUrlHint="The extension connects directly; host access is requested when you sign in."
      blankBaseUrl={null}
      busy={busy}
      waitingLabel={busy ? "Finish signing in in the sign-in window…" : undefined}
      onSignIn={() => void withHostAccess(onSignIn)}
      onRetry={onRetry}
      onConnectToken={(token) => void withHostAccess((url) => onConnect({ baseUrl: url, token }))}
      initialToken={initial?.token ?? ""}
      tokenHint="Stored in this browser's extension storage only."
      error={localError ?? error}
      problem={localError ? null : problem}
      registration={{ redirectUri, origin }}
      footer={
        <small className="connect-register">
          For the operator — register this install in <code>auth.clients.loomboard</code>: redirect
          URI <code>{redirectUri}</code>, allowed origin <code>{origin}</code>.
        </small>
      }
    />
  );
}
