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
import type { LoomcycleClient, WhoamiResponse } from "@loomcycle/client";
import { SIGNED_OUT_MESSAGE, adoptSignIn } from "../lib/signInLifecycle";
import { getClient, resetClient } from "../lib/loomcycle";
import { deriveCapabilities, type Capabilities } from "../lib/capabilities";
import { devConnectSettings } from "../lib/devConnect";
import { isTauri } from "../lib/proxyMode";
import { transportFor } from "../lib/buildConnection";
import {
  SignInInUseError,
  describeSignInError,
  describeTokenRefusal,
  oauthFor,
  type SignInProblemKind,
  type StoredSignIn,
} from "../lib/appSignIn";
import {
  type SignInSession,
  claimSignIn,
  newSignInId,
  storedFrom,
} from "../lib/signInSession";
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
import { parseConnectMessage, readConnectOrigins } from "./connectHandoff";

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
  /** The live "Sign in with loomcycle" session; null for a pasted-token
   *  connection. Pass it to getClient / buildConnection, which use it only for
   *  the settings it belongs to. */
  signIn: SignInSession | null;
  /** Validate + persist a pasted-token connection. Resolves true on success,
   *  false if the whoami validation failed (surfaced via `error`/`status`). */
  connect: (s: ConnectionSettings) => Promise<boolean>;
  /** "Sign in with loomcycle": on the web this navigates away and comes back
   *  to the callback; on the desktop it waits for the system browser. */
  signInWithLoomcycle: (baseUrl: string) => Promise<void>;
  /** Resume the stored sign-in after loomcycle did not answer
   *  (problem "unreachable"). */
  retrySignIn: () => void;
  /** Stop a desktop sign-in that is waiting for the browser. */
  cancelSignIn: () => void;
  /** Sign out (revokes a sign-in on the server) and forget the connection. */
  disconnect: () => void;
}

const Ctx = createContext<ConnectionState | null>(null);

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
  const [signIn, setSignIn] = useState<SignInSession | null>(null);
  // The live sign-in. A ref as well as state: onSignedOut must tell whether it
  // belongs to the CURRENT sign-in (a signed-out-and-replaced one may still
  // report), and disconnect must reach it synchronously.
  const signInRef = useRef<SignInSession | null>(null);
  // A sign-in kept after loomcycle did not answer: not live, still stored,
  // and still to be revoked if the person disconnects instead of retrying.
  const keptRef = useRef<SignInSession | null>(null);
  // Web: releases this tab's hold on its sign-in (see claimSignIn).
  const releaseRef = useRef<(() => void) | null>(null);

  // End whatever sign-in this app holds, live or kept — revoked on its server
  // (RFC 7009) — and clear the stored one even when none is held: a token
  // connection, a disconnect or a failed sign-in must never leave a refresh
  // token behind for the next start to pick up.
  const endSignIn = useCallback(async () => {
    const session = signInRef.current ?? keptRef.current;
    signInRef.current = null;
    keptRef.current = null;
    releaseRef.current?.();
    releaseRef.current = null;
    setSignIn(null);
    resetClient();
    if (session) await session.signOut();
    await (await platformRefreshStore()).clear().catch(() => undefined);
  }, []);

  const fail = useCallback((e: unknown) => {
    const p = describeSignInError(e);
    setPrincipal(null);
    setError(p.message);
    setProblem(p.kind);
    setStatus("error");
  }, []);

  const connect = useCallback(
    async (s: ConnectionSettings): Promise<boolean> => {
      setStatus("connecting");
      setError(null);
      setProblem(null);
      try {
        // A pasted token replaces any sign-in: its tokens belong to the
        // server it was made for, and must not ride along to this one.
        await endSignIn();
        const me = await getClient(s).whoami();
        saveSettings(s);
        setSettings(s);
        setPrincipal(me);
        setStatus("connected");
        return true;
      } catch (e) {
        // Log the raw error for devtools; the UI shows a token-safe summary.
        console.error("[connect] whoami failed", e);
        const message = await describeTokenRefusal(e, oauthFor(transportFor(s.baseUrl)));
        setPrincipal(null);
        setError(message);
        setStatus("error");
        return false;
      }
    },
    [endSignIn],
  );

  // Make a sign-in the app's connection. `fresh` = it came from a code
  // exchange just now (so it is not stored yet); a resumed one already is.
  // Throws if it cannot be used; adoptSignIn decides whether it is kept for
  // a retry or revoked and forgotten.
  const adopt = useCallback(
    async (stored: StoredSignIn, fresh: boolean) => {
      const store = await platformRefreshStore();
      if (!isTauri) {
        // One tab per sign-in: a duplicated tab carries a copy of this one,
        // and two tabs refreshing it would end it for both.
        const release = await claimSignIn(stored.id);
        if (!release) {
          await store.clear();
          throw new SignInInUseError();
        }
        releaseRef.current = release;
      }
      const s = signInSettings(stored.baseUrl);
      await adoptSignIn({
        stored,
        fresh,
        store,
        oauth: oauthFor(transportFor(stored.baseUrl)),
        onSignedOut: (session) => {
          if (signInRef.current !== session) return; // signed out on purpose
          signInRef.current = null;
          releaseRef.current?.();
          releaseRef.current = null;
          resetClient();
          setSignIn(null);
          setPrincipal(null);
          setError(SIGNED_OUT_MESSAGE);
          setProblem(null);
          setStatus("error");
        },
        use: async (session) => {
          // A retry: the same sign-in, now held by this session.
          keptRef.current = null;
          signInRef.current = session;
          resetClient();
          const me = await getClient(s, session).whoami();
          saveSettings(s);
          setSettings(s);
          setSignIn(session);
          setPrincipal(me);
          setError(null);
          setProblem(null);
          setStatus("connected");
        },
        end: endSignIn,
        drop: (session) => {
          // Kept for a retry: remember which server it belongs to, so a
          // reload or a restart resumes it too.
          keptRef.current = session;
          signInRef.current = null;
          releaseRef.current?.();
          releaseRef.current = null;
          resetClient();
          saveSettings(s);
          setSettings(s);
        },
      });
    },
    [endSignIn],
  );

  // Resume the sign-in stored for baseUrl; none stored = the sign-in screen
  // with the Base URL filled in.
  const resume = useCallback(
    async (baseUrl: string) => {
      const stored = await (await platformRefreshStore()).load(baseUrl);
      if (!stored) {
        setStatus("idle");
        return;
      }
      await adopt(stored, false);
    },
    [adopt],
  );

  const retrySignIn = useCallback(() => {
    if (!settings) return;
    setStatus("connecting");
    setError(null);
    setProblem(null);
    void resume(settings.baseUrl).catch(fail);
  }, [settings, resume, fail]);

  const signInWithLoomcycle = useCallback(
    async (baseUrl: string) => {
      const s = signInSettings(baseUrl);
      // The form remounts after the splash: keep what the person entered.
      setSettings(s);
      setStatus(isTauri ? "signing-in" : "connecting");
      setError(null);
      setProblem(null);
      try {
        // A new sign-in replaces a kept one, which must not be left valid.
        if (keptRef.current) await endSignIn();
        if (isTauri) {
          const tokens = await tauriSignIn(transportFor(baseUrl), baseUrl, await tauriInvoke());
          await adopt(storedFrom(baseUrl, tokens, newSignInId()), true);
          return;
        }
        // Keep the Base URL in the form if the person comes back without
        // finishing; no token is stored until the callback succeeds.
        saveSettings(s);
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
    [adopt, fail, endSignIn],
  );

  const cancelSignIn = useCallback(() => {
    if (isTauri) void tauriInvoke().then(cancelTauriSignIn);
  }, []);

  const disconnect = useCallback(() => {
    // Revoke + forget the sign-in; either can fail offline, and the tokens
    // are forgotten locally regardless.
    void endSignIn();
    clearSettings();
    resetClient();
    setSettings(null);
    setSignIn(null);
    setPrincipal(null);
    setError(null);
    setProblem(null);
    setStatus("idle");
  }, [endSignIn]);

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
        .then(({ baseUrl, tokens }) => adopt(storedFrom(baseUrl, tokens, newSignInId()), true))
        .catch(fail);
      return;
    }
    const persisted = loadSettings();
    if (persisted?.auth === "oauth") {
      // No stored sign-in (a new tab, a restart, a sign-out) leaves the
      // sign-in screen with the Base URL filled in.
      void resume(persisted.baseUrl).catch(fail);
      return;
    }
    const initial = persisted ?? devConnectSettings(import.meta.env, persisted);
    if (initial) void connect(initial);
  }, [connect, resume, fail]);

  // Cross-origin connect handoff. A first-party page whose origin is allowlisted
  // (connectOrigins in /runtime-config.js) may postMessage
  // {type:'loomboard.connect', baseUrl, token} to auto-connect a HOSTED loomboard
  // without the user re-pasting their bearer — the same pattern as loomcycle's
  // /ui login. Empty allowlist ⇒ disabled (the default published builds), so no
  // page can hand this app a token unless a deployment opted in. The validation
  // (origin pin + payload shape) lives in parseConnectMessage (unit-tested).
  useEffect(() => {
    const allowed = readConnectOrigins(window.__LOOMBOARD_CONFIG__);
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
        retrySignIn,
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
