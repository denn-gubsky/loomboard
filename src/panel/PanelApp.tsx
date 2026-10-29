import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Square, LogOut, MessageSquarePlus } from "lucide-react";
import {
  Chat,
  createLoomcycleClient,
  type ChatConversation,
  type Connection,
} from "../chat";
import {
  LoomcycleClient,
  type OAuthTokenProvider,
  type OAuthTokenSet,
} from "@loomcycle/client";
import { signInSettings, type ConnectionSettings } from "../state/settings";
import { chromeSessionRefreshStore } from "../state/signInStore";
import { buildConnection } from "../lib/buildConnection";
import {
  describeSignInError,
  resumeTokens,
  startTokenProvider,
  type SignInProblemKind,
} from "../lib/appSignIn";
import { extSignIn } from "../lib/extSignIn";
import { saveExtSettings, clearExtSettings } from "../state/extSettings";
import { persistConversation, newConversation } from "../state/extConversation";
import { saveMode, type ActionMode } from "../state/extMode";
import { describeError } from "../chat/lib/errors";
import { ASSISTANT_AGENT } from "../bridge/protocol";
import { ensureChromeAssistant } from "../bridge/ensureAgent";
import { startClientToolHost } from "../bridge/clientToolHost";
import { approval } from "../bridge/approval";
import { bridgeStatus } from "../bridge/status";
import Connect from "./Connect";
import ActionBar from "./ActionBar";
import ModeToggle from "./ModeToggle";
import BridgeStatusBar from "./BridgeStatusBar";

/** "signing-in" = the sign-in window is open; the panel keeps its form up. */
type Status = "idle" | "connecting" | "signing-in" | "connected" | "error";

// A sign-in's refresh token lives in chrome.storage.session: memory-only,
// gone when the browser quits, and unreadable from content scripts.
const refreshStore = () => chromeSessionRefreshStore(chrome.storage.session);

const signedOutMessage =
  "Your loomcycle sign-in has ended — it was signed out, expired, or revoked. Sign in again.";

interface Props {
  initialSettings: ConnectionSettings | null;
  initialConversation: ChatConversation;
  initialMode: ActionMode;
}

// The side-panel root: a single chat against the browser-assistant agent. No
// sidebar / Library / conversation list — one conversation, persisted to
// chrome.storage. Transport is a plain fetch to the absolute loomcycle URL
// (host_permissions bypass page CORS); a sign-in adds only the bearer (see
// buildConnection).
export default function PanelApp({
  initialSettings,
  initialConversation,
  initialMode,
}: Props) {
  const [settings, setSettings] = useState<ConnectionSettings | null>(
    initialSettings,
  );
  const [status, setStatus] = useState<Status>(
    initialSettings ? "connecting" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<SignInProblemKind | null>(null);
  const [signIn, setSignIn] = useState<OAuthTokenProvider | null>(null);
  // The live sign-in, for onSignedOut (is it still the current one?) and a
  // synchronous disconnect.
  const signInRef = useRef<OAuthTokenProvider | null>(null);
  // The principal (whoami.subject) the client-tool host runs under — display
  // only; the WebSocket derives the routing key from the bearer, not this value.
  const [userId, setUserId] = useState<string | null>(null);
  const [conversation, setConversation] =
    useState<ChatConversation>(initialConversation);

  // Stable Connection identity (keyed on settings + sign-in) so <Chat>'s
  // client memo doesn't churn. The default fetch reaches loomcycle directly
  // under the granted host permission.
  const connection = useMemo<Connection | null>(
    () => (settings ? buildConnection(settings, signIn) : null),
    [settings, signIn],
  );

  // Validate a client and make it the panel's connection. whoami is the only
  // hard gate. Registering the agent uses a surface a plain user token may
  // lack scope for (agent def creation) — it must NOT block connect. The
  // client-tool host itself only needs the bearer.
  const finishConnect = useCallback(async (client: LoomcycleClient, s: ConnectionSettings) => {
    const me = await client.whoami();
    try {
      await ensureChromeAssistant(client);
    } catch (e) {
      console.warn("[loomboard] could not ensure chrome-assistant agent:", e);
    }
    await saveExtSettings(s);
    setSettings(s);
    setUserId(me.subject);
    setError(null);
    setProblem(null);
    setStatus("connected");
  }, []);

  const connect = useCallback(
    async (s: ConnectionSettings) => {
      setStatus("connecting");
      setError(null);
      setProblem(null);
      try {
        await finishConnect(createLoomcycleClient({ baseUrl: s.baseUrl, token: s.token }), s);
      } catch (e) {
        setError(describeError(e));
        setStatus("error");
      }
    },
    [finishConnect],
  );

  const fail = useCallback((e: unknown) => {
    const p = describeSignInError(e);
    setError(p.message);
    setProblem(p.kind);
    setStatus("error");
  }, []);

  // Make a sign-in's tokens the panel's connection. `fresh` = straight from a
  // code exchange, so its refresh token is not stored yet.
  const adoptSignIn = useCallback(
    async (s: ConnectionSettings, tokens: OAuthTokenSet, fresh: boolean) => {
      const store = refreshStore();
      if (fresh) await store.save({ baseUrl: s.baseUrl, refreshToken: tokens.refresh_token });
      const provider = startTokenProvider({
        t: { baseUrl: s.baseUrl },
        baseUrl: s.baseUrl,
        tokens,
        store,
        onSignedOut: () => {
          if (signInRef.current !== provider) return; // signed out on purpose
          signInRef.current = null;
          void store.clear();
          setSignIn(null);
          setUserId(null);
          setError(signedOutMessage);
          setProblem(null);
          setStatus("error");
        },
      });
      signInRef.current = provider;
      // Set before "connected" is, so no render ever builds a token-less
      // connection for a signed-in panel.
      setSignIn(provider);
      try {
        const client = new LoomcycleClient({
          baseUrl: s.baseUrl,
          tokenProvider: provider,
          fetch: (i, init) => fetch(i, init),
        });
        await finishConnect(client, s);
      } catch (e) {
        if (signInRef.current === provider) {
          signInRef.current = null;
          setSignIn(null);
        }
        throw e;
      }
    },
    [finishConnect],
  );

  const signInWithLoomcycle = useCallback(
    async (baseUrl: string) => {
      setStatus("signing-in");
      setError(null);
      setProblem(null);
      try {
        const tokens = await extSignIn(baseUrl, chrome.identity);
        await adoptSignIn(signInSettings(baseUrl), tokens, true);
      } catch (e) {
        fail(e);
      }
    },
    [adoptSignIn, fail],
  );

  // Once on mount: resume a stored sign-in, or validate a persisted token
  // connection (avoids a login-screen flash).
  const validated = useRef(false);
  useEffect(() => {
    if (validated.current) return;
    validated.current = true;
    if (!initialSettings) return;
    if (initialSettings.auth !== "oauth") {
      void connect(initialSettings);
      return;
    }
    void (async () => {
      const refreshToken = await refreshStore().load(initialSettings.baseUrl);
      // No stored sign-in (the browser restarted, or it was signed out).
      if (!refreshToken) {
        setStatus("idle");
        return;
      }
      await adoptSignIn(initialSettings, resumeTokens(refreshToken), false);
    })().catch(fail);
  }, [initialSettings, connect, adoptSignIn, fail]);

  const onConversationChange = useCallback(
    (patch: Partial<ChatConversation>) => {
      setConversation((c) => {
        const next = { ...c, ...patch };
        void persistConversation(next);
        return next;
      });
    },
    [],
  );

  // Pin the conversation to the browser-assistant agent (migrates a pre-pin
  // conversation persisted before the agent was fixed).
  useEffect(() => {
    if (status === "connected" && conversation.baseAgent !== ASSISTANT_AGENT) {
      onConversationChange({ baseAgent: ASSISTANT_AGENT });
    }
  }, [status, conversation.baseAgent, onConversationChange]);

  // The client-tool host's client — a separate WebSocket context from <Chat>'s
  // own streaming client, sharing the same connection. A WebSocket carries no
  // fetch, so a signed-in host takes the token provider itself.
  const loopClient = useMemo(() => {
    if (!connection) return null;
    if (signIn) {
      return new LoomcycleClient({
        baseUrl: connection.baseUrl,
        tokenProvider: signIn,
        fetch: (i, init) => fetch(i, init),
      });
    }
    return createLoomcycleClient(connection);
  }, [connection, signIn]);

  // Action mode. The host reads it through a ref (updated by the toggle) so a
  // mid-run switch takes effect without restarting the host; `mode` state drives
  // the toggle's display.
  const [mode, setMode] = useState<ActionMode>(initialMode);
  const modeRef = useRef<ActionMode>(initialMode);
  const shouldConfirm = useCallback(() => modeRef.current === "confirm", []);
  const onModeChange = useCallback((m: ActionMode) => {
    modeRef.current = m;
    setMode(m);
    void saveMode(m);
  }, []);

  // Stop browser actions: reject any pending approval so a waiting mutating call
  // returns "declined" (which unblocks the agent's tool call). The chat run
  // itself is cancelled by the composer's own stop button; cancelling the run
  // also unblocks any client-tool call still executing, server-side.
  const stop = useCallback(() => {
    approval.cancelPending();
  }, []);

  const disconnect = useCallback(async () => {
    const provider = signInRef.current;
    signInRef.current = null;
    if (provider) {
      // Revoke on the server (RFC 7009) and forget the stored refresh token;
      // either can fail offline, the tokens are forgotten locally regardless.
      void provider.signOut();
      await refreshStore().clear();
    }
    setSignIn(null);
    setProblem(null);
    await clearExtSettings();
    setSettings(null);
    setUserId(null);
    setError(null);
    setStatus("idle");
  }, []);

  // Start a fresh conversation (new loomcycle session) — clears the transcript,
  // including stale error turns from a previous run.
  const newChat = useCallback(() => {
    const c = newConversation();
    setConversation(c);
    void persistConversation(c);
  }, []);

  // Run the client-tool host while connected. The WebSocket derives its routing
  // key from the bearer, so no channel/userId gating is needed — loomcycle
  // offers the browser tools to this user's agents only while this host is live.
  useEffect(() => {
    if (status !== "connected" || !loopClient) return;
    const handle = startClientToolHost(
      loopClient,
      shouldConfirm,
      userId ?? undefined,
      connection?.baseUrl,
    );
    return () => {
      handle.stop();
      bridgeStatus.set("off", "");
    };
  }, [status, loopClient, userId, shouldConfirm, connection]);

  if (status === "connecting") {
    return (
      <div className="splash">
        <Loader2 className="spin" size={22} />
        <span>Connecting to loomcycle…</span>
      </div>
    );
  }
  if (status !== "connected" || !connection) {
    return (
      <Connect
        onConnect={connect}
        onSignIn={signInWithLoomcycle}
        busy={status === "signing-in"}
        error={status === "error" ? error : null}
        problem={problem}
        initial={settings}
      />
    );
  }
  return (
    <div className="ext-panel">
      <BridgeStatusBar />
      <div className="ext-toolbar">
        <ModeToggle mode={mode} onChange={onModeChange} />
        <div className="ext-toolbar-right">
          <button
            className="ext-icon-btn"
            onClick={newChat}
            title="New chat"
            aria-label="New chat"
          >
            <MessageSquarePlus size={14} />
          </button>
          <button className="ext-stop" onClick={stop} title="Stop browser actions">
            <Square size={12} /> Stop
          </button>
          <button
            className="ext-icon-btn"
            onClick={() => void disconnect()}
            title="Disconnect"
            aria-label="Disconnect"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
      <Chat
        // Remount cleanly on a new conversation so no stale session/transcript
        // carries over.
        key={conversation.id}
        connection={connection}
        conversation={conversation}
        onConversationChange={onConversationChange}
      />
      <ActionBar />
    </div>
  );
}
