import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, AlertCircle, Clock } from "lucide-react";
import { signInAddress, type SignInProblemKind } from "../lib/appSignIn";
import brandMark from "../assets/loomboard-favicon.svg";

/** What the operator must register for this build, shown when loomcycle
 *  refuses loomboard as an app. */
export type Registration =
  | { redirectUri: string; origin: string }
  | { preset: true; origin?: string };

interface Props {
  intro: ReactNode;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  baseUrlPlaceholder: string;
  baseUrlHint: ReactNode;
  /** What a blank Base URL reaches on this platform (blankBaseUrlMeans);
   *  null when it reaches nothing. */
  blankBaseUrl: string | null;
  /** A sign-in or a token connect is under way. */
  busy: boolean;
  /** Shown while busy with a sign-in that waits on another window. */
  waitingLabel?: string;
  onCancel?: () => void;
  onSignIn: () => void;
  /** Resume a sign-in that is kept because loomcycle did not answer
   *  (problem "unreachable"). */
  onRetry?: () => void;
  /** The pasted-token path (RFC FL D7), kept under "Advanced". */
  onConnectToken: (token: string) => void;
  initialToken: string;
  tokenHint: ReactNode;
  error: string | null;
  problem: SignInProblemKind | null;
  registration: Registration;
  /** Always-visible notes under the sign-in button. */
  footer?: ReactNode;
}

// The sign-in screen shared by the app (web, desktop) and the extension's side
// panel. The default is "Sign in with loomcycle": the person enters only the
// Base URL and signs in on loomcycle's own page. Pasting a bearer stays
// available under Advanced, for token-only deployments and automation. Open,
// Advanced is the path: its button is the primary one and the sign-in button
// goes away, so the screen offers one action at a time.
export default function SignInCard(p: Props) {
  const [token, setToken] = useState(p.initialToken);
  const [advanced, setAdvanced] = useState(p.initialToken !== "");
  // A server that offers no app sign-in leaves only the token path.
  useEffect(() => {
    if (p.problem === "unsupported") setAdvanced(true);
  }, [p.problem]);
  // Where the sign-in will send the person — the issuer must be on it, so this
  // is shown before anything leaves the app.
  const address = signInAddress(p.baseUrl, p.blankBaseUrl);
  const host = address ? hostOf(address) : null;

  function onSignIn(e: FormEvent) {
    e.preventDefault();
    if (p.busy) return;
    // Enter in the Base URL field still submits this form when its button is
    // hidden; with Advanced open it means the token path, the one on screen.
    if (advanced) p.onConnectToken(token.trim());
    else p.onSignIn();
  }
  function onToken(e: FormEvent) {
    e.preventDefault();
    if (!p.busy) p.onConnectToken(token.trim());
  }

  return (
    <div className="connect-screen">
      <div className="connect-card">
        <div className="connect-head">
          <img className="connect-logo" src={brandMark} alt="loomboard" />
          <h1>Sign in to loomcycle</h1>
        </div>
        <p className="connect-sub">{p.intro}</p>

        <form className="connect-form" onSubmit={onSignIn}>
          <label className="field">
            <span>Base URL</span>
            <input
              type="text"
              inputMode="url"
              placeholder={p.baseUrlPlaceholder}
              value={p.baseUrl}
              onChange={(e) => p.onBaseUrlChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <small>{p.baseUrlHint}</small>
          </label>

          {p.error && (
            <Problem
              kind={p.problem}
              message={p.error}
              registration={p.registration}
              onRetry={p.busy ? undefined : p.onRetry}
            />
          )}

          {p.busy && p.waitingLabel ? (
            <div className="connect-waiting">
              <Loader2 size={16} className="spin" /> {p.waitingLabel}
              {p.onCancel && (
                <button type="button" className="btn-ghost sm" onClick={p.onCancel}>
                  Cancel
                </button>
              )}
            </div>
          ) : advanced ? null : (
            <button type="submit" className="btn-primary" disabled={p.busy}>
              {p.busy ? (
                <>
                  <Loader2 size={16} className="spin" /> Signing in…
                </>
              ) : host ? (
                <>Sign in with loomcycle at {host}</>
              ) : (
                "Sign in with loomcycle"
              )}
            </button>
          )}
          {p.footer}
        </form>

        <details
          className="connect-advanced"
          open={advanced}
          onToggle={(e) => setAdvanced((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>Advanced</summary>
          <form className="connect-form" onSubmit={onToken}>
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
              <small>
                {p.tokenHint} On a server that requires sign-in, only an operator or service token works
                here.
              </small>
            </label>
            <button type="submit" className="btn-primary" disabled={p.busy}>
              Connect with token
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function Problem({
  kind,
  message,
  registration,
  onRetry,
}: {
  kind: SignInProblemKind | null;
  message: string;
  registration: Registration;
  onRetry?: () => void;
}) {
  if (kind === "pending") {
    return (
      <div className="connect-note" role="status">
        <Clock size={16} />
        <span>{message}</span>
      </div>
    );
  }
  return (
    <div className="connect-error" role="alert">
      <AlertCircle size={16} />
      <div>
        <span>{message}</span>
        {kind === "unregistered" && <RegistrationHint r={registration} />}
        {kind === "unreachable" && onRetry && (
          <button type="button" className="btn-ghost sm" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function RegistrationHint({ r }: { r: Registration }) {
  if ("preset" in r) {
    return (
      <p className="connect-register">
        Enable loomcycle&apos;s <code>loomboard</code> preset (
        <code>LOOMCYCLE_PRESETS=…,loomboard</code>)
        {r.origin && (
          <>
            {" "}
            and add <code>{r.origin}</code> to <code>auth.clients.loomboard.allowed_origins</code>
          </>
        )}
        .
      </p>
    );
  }
  return (
    <p className="connect-register">
      Register in <code>auth.clients.loomboard</code>: redirect URI <code>{r.redirectUri}</code> and
      allowed origin <code>{r.origin}</code>.
    </p>
  );
}
