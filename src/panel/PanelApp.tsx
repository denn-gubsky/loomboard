import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
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
      await createLoomcycleClient({
        baseUrl: s.baseUrl,
        token: s.token,
      }).whoami();
      await saveExtSettings(s);
      setSettings(s);
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
      <Chat
        connection={connection}
        conversation={conversation}
        onConversationChange={onConversationChange}
      />
    </div>
  );
}
