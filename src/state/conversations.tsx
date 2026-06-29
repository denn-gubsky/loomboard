import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Per-conversation model overrides. provider/model/tier/effort can only be set
// on an AgentDef, so when any of these differ from the base agent we fork a
// private def at first send (see useChat). `effort` is loomcycle's thinking-mode
// knob (maps to Anthropic thinking budget / OpenAI reasoning_effort / DeepSeek
// toggle); "" means inherit the base agent's setting.
export interface ConversationConfig {
  provider?: string;
  model?: string;
  tier?: string;
  effort?: string;
}

export interface Conversation {
  id: string;
  title: string;
  /** Library agent this chat is based on. "" until the user picks one. */
  baseAgent: string;
  config: ConversationConfig;
  /** Name of the per-conversation AgentDef fork, once created. */
  forkDefName?: string;
  /** loomcycle session + interactive run, set after the first turn. */
  sessionId?: string;
  runId?: string;
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

/** True when the conversation's config diverges from the base agent and a fork
 *  is needed. Pure helper shared by the config panel and useChat. */
export function configIsCustom(config: ConversationConfig): boolean {
  return Boolean(
    config.provider || config.model || config.tier || config.effort,
  );
}
