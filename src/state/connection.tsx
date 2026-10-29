import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  LoomcycleClient,
  OAuthTokenProvider,
  OAuthTokenSet,
  WhoamiResponse,
} from "@loomcycle/client";
import { getClient, resetClient } from "../lib/loomcycle";
import { deriveCapabilities, type Capabilities } from "../lib/capabilities";
import { describeError } from "../chat/lib/errors";
import { devConnectSettings } from "../lib/devConnect";
import { isTauri } from "../lib/proxyMode";
import { transportFor } from "../lib/buildConnection";
import {
  describeSignInError,
  resumeTokens,
  startTokenProvider,
  type SignInProblemKind,
} from "../lib/appSignIn";
import { finishWebSignIn, isWebCallback, startWebSignIn } from "../lib/webSignIn";
import { platformRefreshStore, tauriInvoke } from "../lib/signInPlatform";
import { cancelTauriSignIn, tauriSignIn } from "../lib/tauriSignIn";
import {
  clearSettings,
  loadSettings,
  saveSettings,
  signInSettings,
  type ConnectionSettings,
} from "./settings";
import { parseConnectMessage, parseConnectOrigins } from "./connectHandoff";

/** "signing-in" = waiting on the person in another window (the desktop app's
 *  system browser), so the sign-in screen stays up with a Cancel button. */
type Status = "idle" | "connecting" | "signing-in" | "connected" | "error";

interface ConnectionState {
  status: Status;
  settings: ConnectionSettings | null;
  principal: WhoamiResponse | null;
  /** What the bearer can reach (derived from the principal's scopes). Gates the
   *  tenant-only surfaces so a delegated user token (RFC BX) stays usable. */
  capabilities: Capabilities;
  error: string | null;
  /** Why the last sign-in failed, when it did; "unsupported" is the cue to
   *  offer the pasted-token path. */
  problem: SignInProblemKind | null;
  /** The token provider of a "Sign in with loomcycle" connection; null for a
   *  pasted-token one. Pass it to getClient / buildConnection. */
  signIn: OAuthTokenProvider | null;
  /** Validate + persist a pasted-token connection. Resolves true on success,
   *  false if the whoami validation failed (surfaced via `error`/`status`). */
  connect: (s: ConnectionSettings) => Promise<boolean>;
  /** "Sign in with loomcycle": on the web this navigates away and comes back
   *  to the callback; on the desktop it waits for the system browser. */
  signInWithLoomcycle: (baseUrl: string) => Promise<void>;
  /** Stop a desktop sign-in that is waiting for the browser. */
  cancelSignIn: () => void;
  /** Sign out (revokes a sign-in on the server) and forget the connection. */
  disconnect: () => void;
}

const Ctx = createContext<ConnectionState | null>(null);

const signedOutMessage =
  "Your loomcycle sign-in has ended — it was signed out, expired, or revoked. Sign in again.";

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ConnectionSettings | null>(() =>
    loadSettings(),
  );
  // If we have a connection to validate — persisted, a sign-in coming back,
  // or the dev-only env seed — we start in "connecting" and validate it before
  // showing the app, which avoids a flash of the login screen on reload.
  const [status, setStatus] = useState<Status>(() => {
    const persisted = loadSettings();
    return persisted ||
      (!isTauri && isWebCallback(window.location)) ||
      devConnectSettings(import.meta.env, persisted)
      ? "connecting"
      : "idle";
  });
  const [principal, setPrincipal] = useState<WhoamiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<SignInProblemKind | null>(null);
  const [signIn, setSignIn] = useState<OAuthTokenProvider | null>(null);
  // The live sign-in. A ref as well as state: onSignedOut must tell whether it
  // belongs to the CURRENT sign-in (a signed-out-and-replaced one may still
  // report), and disconnect must reach it synchronously.
  const signInRef = useRef<OAuthTokenProvider | null>(null);

  const fail = useCallback((e: unknown) => {
    const p = describeSignInError(e);
    setPrincipal(null);
    setError(p.message);
    setProblem(p.kind);
    setStatus("error");
  }, []);

  const connect = useCallback(async (s: ConnectionSettings): Promise<boolean> => {
    setStatus("connecting");
    setError(null);
    setProblem(null);
    try {
      resetClient();
      const me = await getClient(s).whoami();
      saveSettings(s);
      setSettings(s);
      setPrincipal(me);
      setStatus("connected");
      return true;
    } catch (e) {
      // Log the raw error for devtools; the UI shows a token-safe summary.
      console.error("[connect] whoami failed", e);
      setPrincipal(null);
      setError(describeError(e));
      setStatus("error");
      return false;
    }
  }, []);

  // Make a sign-in's tokens the app's connection. `fresh` = they came from a
  // code exchange just now (so the refresh token is not stored yet); a resumed
  // sign-in already is. Throws if the server will not have it.
  const adoptSignIn = useCallback(
    async (baseUrl: string, tokens: OAuthTokenSet, fresh: boolean) => {
      const store = await platformRefreshStore();
      if (fresh) await store.save({ baseUrl, refreshToken: tokens.refresh_token });
      const provider = startTokenProvider({
        t: transportFor(baseUrl),
        baseUrl,
        tokens,
        store,
        onSignedOut: () => {
          if (signInRef.current !== provider) return; // signed out on purpose
          signInRef.current = null;
          void store.clear();
          resetClient();
          setSignIn(null);
          setPrincipal(null);
          setError(signedOutMessage);
          setProblem(null);
          setStatus("error");
        },
      });
      signInRef.current = provider;
      const s = signInSettings(baseUrl);
      resetClient();
      let me: WhoamiResponse;
      try {
        me = await getClient(s, provider).whoami();
      } catch (e) {
        // Not connected after all; the stored refresh token stays, so a
        // reload retries a transient failure.
        if (signInRef.current === provider) signInRef.current = null;
        throw e;
      }
      saveSettings(s);
      setSettings(s);
      setSignIn(provider);
      setPrincipal(me);
      setError(null);
      setProblem(null);
      setStatus("connected");
    },
    [],
  );

  const signInWithLoomcycle = useCallback(
    async (baseUrl: string) => {
      setStatus(isTauri ? "signing-in" : "connecting");
      setError(null);
      setProblem(null);
      try {
        if (isTauri) {
          const tokens = await tauriSignIn(transportFor(baseUrl), baseUrl, await tauriInvoke());
          await adoptSignIn(baseUrl, tokens, true);
          return;
        }
        // Keep the Base URL in the form if the person comes back without
        // finishing; no token is stored until the callback succeeds.
        saveSettings(signInSettings(baseUrl));
        await startWebSignIn(baseUrl, {
          storage: sessionStorage,
          assign: (url) => window.location.assign(url),
          loc: window.location,
        });
        // The page is navigating to loomcycle; stay "connecting".
      } catch (e) {
        fail(e);
      }
    },
    [adoptSignIn, fail],
  );

  const cancelSignIn = useCallback(() => {
    if (isTauri) void tauriInvoke().then(cancelTauriSignIn);
  }, []);

  const disconnect = useCallback(() => {
    const provider = signInRef.current;
    signInRef.current = null;
    if (provider) {
      // Revoke on the server (RFC 7009) and forget the stored refresh token.
      // Either can fail offline; the tokens are forgotten locally regardless.
      void provider.signOut();
      void platformRefreshStore().then((s) => s.clear());
    }
    clearSettings();
    resetClient();
    setSettings(null);
    setSignIn(null);
    setPrincipal(null);
    setError(null);
    setProblem(null);
    setStatus("idle");
  }, []);

  // Once on first mount: finish a sign-in this page was redirected back to,
  // resume a stored sign-in, or validate a persisted token connection —
  // falling back in dev to the VITE_DEV_TOKEN seed (see lib/devConnect;
  // compiled out of every build), so a `VITE_DEV_TOKEN=… npm run dev` opens
  // straight into the app.
  const validatedRef = useRef(false);
  useEffect(() => {
    if (validatedRef.current) return;
    validatedRef.current = true;
    if (!isTauri && isWebCallback(window.location)) {
      void finishWebSignIn({
        storage: sessionStorage,
        href: window.location.href,
        replaceState: (path) => window.history.replaceState(null, "", path),
      })
        .then(({ baseUrl, tokens }) => adoptSignIn(baseUrl, tokens, true))
        .catch(fail);
      return;
    }
    const persisted = loadSettings();
    if (persisted?.auth === "oauth") {
      void (async () => {
        const refreshToken = await (await platformRefreshStore()).load(persisted.baseUrl);
        // No stored sign-in (a new tab, a restart, a sign-out): show the
        // sign-in screen with the Base URL filled in.
        if (!refreshToken) {
          setStatus("idle");
          return;
        }
        await adoptSignIn(persisted.baseUrl, resumeTokens(refreshToken), false);
      })().catch(fail);
      return;
    }
    const initial = persisted ?? devConnectSettings(import.meta.env, persisted);
    if (initial) void connect(initial);
  }, [connect, adoptSignIn, fail]);

  // Cross-origin connect handoff. A first-party page whose origin is allowlisted
  // (VITE_LOOMBOARD_CONNECT_ORIGINS) may postMessage
  // {type:'loomboard.connect', baseUrl, token} to auto-connect a HOSTED loomboard
  // without the user re-pasting their bearer — the same pattern as loomcycle's
  // /ui login. Empty allowlist ⇒ disabled (the default published builds), so no
  // page can hand this app a token unless a deployment opted in. The validation
  // (origin pin + payload shape) lives in parseConnectMessage (unit-tested).
  useEffect(() => {
    const allowed = parseConnectOrigins(
      import.meta.env.VITE_LOOMBOARD_CONNECT_ORIGINS,
    );
    if (allowed.length === 0) return;
    const onMessage = (e: MessageEvent) => {
      const handoff = parseConnectMessage(allowed, e.origin, e.data);
      if (!handoff) return;
      void connect(handoff).then((ok) => {
        if (!ok) return;
        // ack so the opener can stop resending — its first message may arrive
        // before this receiver mounts, so senders retry until this reply.
        try {
          (e.source as Window | null)?.postMessage(
            { type: "loomboard.connect.ok" },
            e.origin,
          );
        } catch {
          /* opener gone — harmless */
        }
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [connect]);

  const capabilities = useMemo(() => deriveCapabilities(principal), [principal]);

  return (
    <Ctx.Provider
      value={{
        status,
        settings,
        principal,
        capabilities,
        error,
        problem,
        signIn,
        connect,
        signInWithLoomcycle,
        cancelSignIn,
        disconnect,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useConnection(): ConnectionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConnection must be used within ConnectionProvider");
  return v;
}

/** The connected client. Throws if called before a successful connection —
 *  components that render only when status === "connected" can call it freely. */
export function useLoomcycle(): LoomcycleClient {
  const { status, settings, signIn } = useConnection();
  if (status !== "connected" || !settings) {
    throw new Error("useLoomcycle called while not connected");
  }
  return getClient(settings, signIn);
}
