import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LoomcycleClient, WhoamiResponse } from "@loomcycle/client";
import { getClient, resetClient } from "../lib/loomcycle";
import { describeError } from "../chat/lib/errors";
import {
  clearSettings,
  loadSettings,
  saveSettings,
  type ConnectionSettings,
} from "./settings";

type Status = "idle" | "connecting" | "connected" | "error";

interface ConnectionState {
  status: Status;
  settings: ConnectionSettings | null;
  principal: WhoamiResponse | null;
  error: string | null;
  connect: (s: ConnectionSettings) => Promise<void>;
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

  const connect = useCallback(async (s: ConnectionSettings) => {
    setStatus("connecting");
    setError(null);
    try {
      resetClient();
      const me = await getClient(s).whoami();
      saveSettings(s);
      setSettings(s);
      setPrincipal(me);
      setStatus("connected");
    } catch (e) {
      setPrincipal(null);
      setError(describeError(e));
      setStatus("error");
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

  return (
    <Ctx.Provider
      value={{ status, settings, principal, error, connect, disconnect }}
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
