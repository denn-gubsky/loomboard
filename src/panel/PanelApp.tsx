import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Square, LogOut, MessageSquarePlus } from "lucide-react";
import {
  Chat,
  createLoomcycleClient,
  type ChatConversation,
  type Connection,
} from "../chat";
import type { ConnectionSettings } from "../state/settings";
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

type Status = "idle" | "connecting" | "connected" | "error";

interface Props {
  initialSettings: ConnectionSettings | null;
  initialConversation: ChatConversation;
  initialMode: ActionMode;
}

// The side-panel root: a single chat against the browser-assistant agent. No
// sidebar / Library / conversation list — one conversation, persisted to
// chrome.storage. Transport is a plain fetch to the absolute loomcycle URL
// (host_permissions bypass page CORS), so the Connection needs no fetch override.
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
  // The principal (whoami.subject) the client-tool host runs under — display
  // only; the WebSocket derives the routing key from the bearer, not this value.
  const [userId, setUserId] = useState<string | null>(null);
  const [conversation, setConversation] =
    useState<ChatConversation>(initialConversation);

  // Stable Connection identity (keyed on settings) so <Chat>'s client memo
  // doesn't churn. No fetch override — the default fetch reaches loomcycle
  // directly under the granted host permission.
  const connection = useMemo<Connection | null>(
    () =>
      settings ? { baseUrl: settings.baseUrl, token: settings.token } : null,
    [settings],
  );

  const connect = useCallback(async (s: ConnectionSettings) => {
    setStatus("connecting");
    setError(null);
    try {
      const client = createLoomcycleClient({
        baseUrl: s.baseUrl,
        token: s.token,
      });
      // whoami is the only hard gate. Registering the agent uses a surface a
      // plain user token may lack scope for (agent def creation) — it must NOT
      // block connect. The client-tool host itself only needs the bearer.
      const me = await client.whoami();
      try {
        await ensureChromeAssistant(client);
      } catch (e) {
        console.warn("[loomboard] could not ensure chrome-assistant agent:", e);
      }
      await saveExtSettings(s);
      setSettings(s);
      setUserId(me.subject);
      setStatus("connected");
    } catch (e) {
      setError(describeError(e));
      setStatus("error");
    }
  }, []);

  // Validate persisted settings once on mount (avoids a login-screen flash).
  const validated = useRef(false);
  useEffect(() => {
    if (validated.current) return;
    validated.current = true;
    if (initialSettings) void connect(initialSettings);
  }, [initialSettings, connect]);

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
  // own streaming client, sharing the same connection.
  const loopClient = useMemo(
    () => (connection ? createLoomcycleClient(connection) : null),
    [connection],
  );

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
    const handle = startClientToolHost(loopClient, shouldConfirm, userId ?? undefined);
    return () => {
      handle.stop();
      bridgeStatus.set("off", "");
    };
  }, [status, loopClient, userId, shouldConfirm]);

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
        error={status === "error" ? error : null}
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
