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
import { getClient, resetClient } from "../lib/loomcycle";
import { deriveCapabilities, type Capabilities } from "../lib/capabilities";
import { describeError } from "../chat/lib/errors";
import {
  clearSettings,
  loadSettings,
  saveSettings,
  type ConnectionSettings,
} from "./settings";
import { parseConnectMessage, parseConnectOrigins } from "./connectHandoff";

type Status = "idle" | "connecting" | "connected" | "error";

interface ConnectionState {
  status: Status;
  settings: ConnectionSettings | null;
  principal: WhoamiResponse | null;
  /** What the bearer can reach (derived from the principal's scopes). Gates the
   *  tenant-only surfaces so a delegated user token (RFC BX) stays usable. */
  capabilities: Capabilities;
  error: string | null;
  /** Validate + persist a connection. Resolves true on success, false if the
   *  whoami validation failed (the error is surfaced via `error`/`status`). */
  connect: (s: ConnectionSettings) => Promise<boolean>;
  disconnect: () => void;
}

const Ctx = createContext<ConnectionState | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ConnectionSettings | null>(() =>
    loadSettings(),
  );
  // If we have persisted settings, we start in "connecting" and validate them
  // before showing the app — avoids a flash of the login screen on reload.
  const [status, setStatus] = useState<Status>(() =>
    loadSettings() ? "connecting" : "idle",
  );
  const [principal, setPrincipal] = useState<WhoamiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (s: ConnectionSettings): Promise<boolean> => {
    setStatus("connecting");
    setError(null);
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

  const disconnect = useCallback(() => {
    clearSettings();
    resetClient();
    setSettings(null);
    setPrincipal(null);
    setError(null);
    setStatus("idle");
  }, []);

  // Validate a persisted connection exactly once on first mount.
  const validatedRef = useRef(false);
  useEffect(() => {
    if (validatedRef.current) return;
    validatedRef.current = true;
    const persisted = loadSettings();
    if (persisted) void connect(persisted);
  }, [connect]);

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
      value={{ status, settings, principal, capabilities, error, connect, disconnect }}
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
  const { status, settings } = useConnection();
  if (status !== "connected" || !settings) {
    throw new Error("useLoomcycle called while not connected");
  }
  return getClient(settings);
}
