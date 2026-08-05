import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Shared state bus for the ACTIVE chat, bridging the sidebar and the main pane:
//  - status flows main → sidebar: the chat surface knows when the agent is
//    working vs parked on a question (useChat); the aggregate run-state feed
//    lags a just-started run and can't tell working from parked, so the tile's
//    activity dot would read stale. ChatArea publishes; ConversationList reads.
//  - recap flows sidebar → main: the History summary lives with the chat list
//    (useChatHistory); ConversationList publishes it and the main pane renders
//    it as a ghost message (the tile has no room for it).

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
  /** The active chat's stored recap summary, or null. */
  recap: string | null;
  setRecap: (s: string | null) => void;
}

const Ctx = createContext<ActiveChatState | null>(null);

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ActiveChatStatus>(IDLE);
  const [recap, setRecap] = useState<string | null>(null);
  const value = useMemo(
    () => ({ status, setStatus, recap, setRecap }),
    [status, recap],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveChat(): ActiveChatState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveChat must be used within ActiveChatProvider");
  return v;
}
