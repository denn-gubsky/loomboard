import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChatConversation, ConversationConfig } from "../chat/types";

// Config shape + helpers live with the chat component (its config panel and
// fork logic own them); re-exported so existing app imports keep working.
export type { ConversationConfig } from "../chat/types";
export { configIsCustom, sameConfig } from "../chat/types";

// The app's conversation record extends the chat's controlled shape with local
// index metadata (creation/activity timestamps) the component doesn't need.
export interface Conversation extends ChatConversation {
  createdAt: number;
  updatedAt: number;
}

const KEY = "loomboard.conversations";

function load(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Conversation[]) : [];
  } catch {
    return [];
  }
}

function persist(list: Conversation[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

interface ConversationsState {
  conversations: Conversation[];
  activeId: string | null;
  active: Conversation | null;
  select: (id: string | null) => void;
  create: (baseAgent?: string, config?: ConversationConfig) => Conversation;
  update: (id: string, patch: Partial<Conversation>) => void;
  remove: (id: string) => void;
}

const Ctx = createContext<ConversationsState | null>(null);

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>(() => load());
  const [activeId, setActiveId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => setActiveId(id), []);

  const create = useCallback<ConversationsState["create"]>(
    (baseAgent = "", config = {}) => {
      const now = Date.now();
      const convo: Conversation = {
        id: crypto.randomUUID(),
        title: "New chat",
        baseAgent,
        config,
        createdAt: now,
        updatedAt: now,
      };
      setConversations((prev) => {
        const next = [convo, ...prev];
        persist(next);
        return next;
      });
      setActiveId(convo.id);
      return convo;
    },
    [],
  );

  const update = useCallback<ConversationsState["update"]>((id, patch) => {
    setConversations((prev) => {
      const next = prev.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
      );
      persist(next);
      return next;
    });
  }, []);

  const remove = useCallback<ConversationsState["remove"]>((id) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persist(next);
      return next;
    });
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const value = useMemo<ConversationsState>(
    () => ({ conversations, activeId, active, select, create, update, remove }),
    [conversations, activeId, active, select, create, update, remove],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConversations(): ConversationsState {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useConversations must be used within ConversationsProvider");
  }
  return v;
}
