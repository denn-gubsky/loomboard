import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Bridges the active <Chat>'s live run state to the sidebar. The chat surface
// knows when the agent is working (thinking / responding / using tools) vs
// parked on a question (useChat); the aggregate run-state feed usually doesn't
// have a just-started run, and its "running" can't tell working from parked. So
// the tile's activity dot would read stale. ChatArea publishes here;
// ConversationList reads it for the active tile.

export interface ActiveChatStatus {
  /** The agent is actively working right now (not parked awaiting input). */
  running: boolean;
  /** The agent parked on a question and needs an answer. */
  needsInput: boolean;
}

const IDLE: ActiveChatStatus = { running: false, needsInput: false };

interface ActiveChatState {
  status: ActiveChatStatus;
  setStatus: (s: ActiveChatStatus) => void;
}

const Ctx = createContext<ActiveChatState | null>(null);

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ActiveChatStatus>(IDLE);
  const value = useMemo(() => ({ status, setStatus }), [status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveChat(): ActiveChatState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveChat must be used within ActiveChatProvider");
  return v;
}
