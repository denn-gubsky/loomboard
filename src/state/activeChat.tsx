import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Bridges the active <Chat>'s live run state to the sidebar. The chat surface
// knows when the agent is thinking / responding / using tools (useChat.running);
// the aggregate run-state feed usually doesn't have a just-started run, so the
// tile's activity dot would read stale. ChatArea publishes here; ConversationList
// reads it for the active tile.

interface ActiveChatState {
  /** The active chat's agent is working right now. */
  running: boolean;
  setRunning: (v: boolean) => void;
}

const Ctx = createContext<ActiveChatState | null>(null);

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const value = useMemo(() => ({ running, setRunning }), [running]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveChat(): ActiveChatState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveChat must be used within ActiveChatProvider");
  return v;
}
