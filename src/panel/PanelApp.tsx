import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import {
  Chat,
  createLoomcycleClient,
  type ChatConversation,
  type Connection,
} from "../chat";
import type { ConnectionSettings } from "../state/settings";
import { saveExtSettings } from "../state/extSettings";
import { persistConversation } from "../state/extConversation";
import { describeError } from "../chat/lib/errors";
import { ASSISTANT_AGENT } from "../bridge/protocol";
import { ensureChromeAssistant } from "../bridge/ensureAgent";
import { preflightChannels } from "../bridge/ensureChannels";
import Connect from "./Connect";

type Status = "idle" | "connecting" | "connected" | "error";

interface Props {
  initialSettings: ConnectionSettings | null;
  initialConversation: ChatConversation;
}

// The side-panel root: a single chat against the browser-assistant agent. No
// sidebar / Library / conversation list — one conversation, persisted to
// chrome.storage. Transport is a plain fetch to the absolute loomcycle URL
// (host_permissions bypass page CORS), so the Connection needs no fetch override.
export default function PanelApp({
  initialSettings,
  initialConversation,
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
      await client.whoami();
      // Ensure the assistant agent exists, then check the bridge channels.
      await ensureChromeAssistant(client);
      const pf = await preflightChannels(client);
      await saveExtSettings(s);
      setSettings(s);
      setMissingChannels(pf.ok ? null : pf.missing);
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
        connection={connection}
        conversation={conversation}
        onConversationChange={onConversationChange}
      />
    </div>
  );
}
