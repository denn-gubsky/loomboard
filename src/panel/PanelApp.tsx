import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Square,
  LogOut,
  MessageSquarePlus,
} from "lucide-react";
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
import { preflightChannels } from "../bridge/ensureChannels";
import { startChannelLoop } from "../bridge/channelLoop";
import { approval } from "../bridge/approval";
import Connect from "./Connect";
import ActionBar from "./ActionBar";
import ModeToggle from "./ModeToggle";

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
  // Non-null when the browser-bridge channels aren't declared on loomcycle:
  // chat still works, but actuation is disabled until an operator adds them.
  const [missingChannels, setMissingChannels] = useState<string[] | null>(null);
  // The channel scope id (whoami.subject) the browser bridge routes on.
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
    setMissingChannels(null);
    try {
      const client = createLoomcycleClient({
        baseUrl: s.baseUrl,
        token: s.token,
      });
      // whoami is the only hard gate. Registering the agent and listing channels
      // use surfaces a plain user token may lack scope for (agent def creation;
      // the operator-only GET /v1/_channels) — those must NOT block connect. The
      // bridge itself uses user-scoped channel ops the token CAN perform.
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
      // Best-effort channel preflight; a user token usually can't list operator
      // channels, so a failure here is expected and silently ignored.
      void preflightChannels(client)
        .then((pf) => setMissingChannels(pf.ok ? null : pf.missing))
        .catch(() => undefined);
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

  // The browser-bridge client — a separate long-poll context from <Chat>'s own
  // streaming client, sharing the same connection.
  const loopClient = useMemo(
    () => (connection ? createLoomcycleClient(connection) : null),
    [connection],
  );

  // Action mode. The loop reads it through a ref (updated by the toggle) so a
  // mid-run switch takes effect without restarting the loop; `mode` state drives
  // the toggle's display.
  const [mode, setMode] = useState<ActionMode>(initialMode);
  const modeRef = useRef<ActionMode>(initialMode);
  const shouldConfirm = useCallback(() => modeRef.current === "confirm", []);
  const onModeChange = useCallback((m: ActionMode) => {
    modeRef.current = m;
    setMode(m);
    void saveMode(m);
  }, []);

  // Stop: bump the epoch to tear down and restart the loop (aborts the in-flight
  // poll + pending approval; a fresh startedAt makes queued commands stale, so
  // the assistant stops acting on the current run). The chat run itself is
  // cancelled by the composer's own stop button.
  const [loopEpoch, setLoopEpoch] = useState(0);
  const stop = useCallback(() => {
    approval.cancelPending();
    setLoopEpoch((e) => e + 1);
  }, []);

  const disconnect = useCallback(async () => {
    await clearExtSettings();
    setSettings(null);
    setUserId(null);
    setMissingChannels(null);
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

  // Run the browser bridge while connected and the bridge channels exist.
  useEffect(() => {
    if (
      status !== "connected" ||
      !loopClient ||
      !userId ||
      (missingChannels && missingChannels.length > 0)
    ) {
      return;
    }
    const handle = startChannelLoop(loopClient, userId, shouldConfirm);
    return () => handle.stop();
    // loopEpoch in deps so Stop restarts the loop with a fresh startedAt.
  }, [status, loopClient, userId, missingChannels, shouldConfirm, loopEpoch]);

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
      {missingChannels && missingChannels.length > 0 && (
        <div className="ext-warning" role="alert">
          <AlertCircle size={14} />
          <span>
            Browser actions are disabled: loomcycle is missing{" "}
            {missingChannels.join(" and ")}. Ask an operator to declare them
            (scope: user). Chat still works.
          </span>
        </div>
      )}
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
