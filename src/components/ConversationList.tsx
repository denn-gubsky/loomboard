import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import type { InterruptRow } from "@loomcycle/client";
import { useConversations } from "../state/conversations";
import { useActiveChat } from "../state/activeChat";
import { useConnection, useLoomcycle } from "../state/connection";
import { deleteConversationAgent } from "../chat/lib/agentFork";
import { useUserRunStates } from "../hooks/useUserRunStates";
import { useUserInterrupts } from "../hooks/useUserInterrupts";
import { useChatHistory } from "../hooks/useChatHistory";
import { useAutoRecap } from "../hooks/useAutoRecap";
import { mergeChats, type DisplayChat } from "../lib/chatIndex";
import type { RunTile } from "../lib/runStates";
import HistorySearch, { NO_FILTER, type ChatFilter } from "./HistorySearch";
import ConversationTile from "./agentchat/ConversationTile";

// The first pending question on any of a chat's runs. The interrupts poll keys on
// run_id and a chat can span several runs (steer, re-open, resident sub-turns), so
// we check every run id we know for the session — not just the newest.
function firstPending(
  runIds: Set<string> | undefined,
  interrupts: Map<string, InterruptRow>,
): InterruptRow | undefined {
  if (!runIds) return undefined;
  for (const rid of runIds) {
    const q = interrupts.get(rid);
    if (q) return q;
  }
  return undefined;
}

// The left panel: the user's prior chats as MINIMIZED live tiles. The list is the
// merge of loomcycle History (server-side, per-user, authoritative title/summary/
// status — so chats started on other devices show too) with the local store
// (agent/config for continuing, plus unsent drafts), deduped by sessionId. Live
// state comes from ONE aggregate run-state stream + one interrupts poll, joined by
// sessionId. Rename → History; delete → archive (reversible) for a sent chat, or
// hard-remove for a draft. Search filters by title (instant) or semantics (server).
export default function ConversationList({ collapsed }: { collapsed: boolean }) {
  const { conversations, activeId, select, update, remove, openSession } =
    useConversations();
  const client = useLoomcycle();
  const { principal, capabilities } = useConnection();
  const userId = principal?.subject ?? null;
  // The History tool (/v1/_history) requires substrate:tenant — a delegated user
  // token 403s, so skip it entirely and let the list fall back to the local
  // store. Rename stays local, archive/search/recap are hidden (see below).
  const canTenant = capabilities.canTenant;

  const history = useChatHistory(client, Boolean(userId) && canTenant);
  const { tiles } = useUserRunStates(client, userId);
  const interrupts = useUserInterrupts(client, userId);
  // The active chat's live run state, published by <Chat> — the aggregate feed
  // lags a just-started run and can't tell working from parked, so its tile dot
  // would otherwise read stale (and pulse forever on a parked question).
  const { status: activeStatus, setRecap } = useActiveChat();

  // Newest run per session — for the tile's live status dot + preview refresh.
  const runBySession = useMemo(() => {
    const m = new Map<string, RunTile>();
    for (const t of tiles) if (t.sessionId && !m.has(t.sessionId)) m.set(t.sessionId, t);
    return m;
  }, [tiles]);

  // ALL run ids we know per session (the aggregate feed + each local chat's
  // persisted runId), so a pending question is found whichever run raised it —
  // and immediately for a chat just parked here, before the feed catches up.
  const runIdsBySession = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (sid: string | undefined, rid: string | undefined) => {
      if (!sid || !rid) return;
      const set = m.get(sid) ?? new Set<string>();
      set.add(rid);
      m.set(sid, set);
    };
    for (const t of tiles) add(t.sessionId, t.runId);
    for (const c of conversations) add(c.sessionId, c.runId);
    return m;
  }, [tiles, conversations]);

  const merged = useMemo(
    () => mergeChats(history.sessions, conversations),
    [history.sessions, conversations],
  );

  // Auto-recap the active chat when it sits idle for 3 min (see useAutoRecap).
  // Keyed on the History row's last_activity — a parked interactive run still
  // reports "running", so idle can't be read off the run status.
  const activeSessionId = conversations.find((c) => c.id === activeId)?.sessionId;
  const activeChat = activeSessionId
    ? merged.find((c) => c.sessionId === activeSessionId)
    : undefined;
  const activeLastActivity = activeChat?.lastActivity ?? 0;

  // Publish the active chat's recap to the main pane (it renders it as a ghost
  // message — the tile has no room). null clears it when there's no active chat.
  useEffect(() => {
    setRecap(activeChat?.summary ?? null);
  }, [activeChat?.summary, setRecap]);

  useAutoRecap({
    // recap is a History op — don't arm it without tenant reach.
    sessionId: canTenant ? activeSessionId : undefined,
    lastActivity: activeLastActivity,
    recap: history.recap,
  });

  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<ChatFilter>(NO_FILTER);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    let r = merged.filter((c) => (showArchived ? c.archived : !c.archived));
    if (filter.semanticIds) {
      const order = new Map(filter.semanticIds.map((id, i) => [id, i] as const));
      r = r
        .filter((c) => c.sessionId && order.has(c.sessionId))
        .sort((a, b) => order.get(a.sessionId!)! - order.get(b.sessionId!)!);
    } else if (filter.text) {
      r = r.filter((c) => c.title.toLowerCase().includes(filter.text));
    }
    return r;
  }, [merged, showArchived, filter]);

  function doOpen(chat: DisplayChat) {
    setConfirmingKey(null);
    setRenamingKey(null);
    if (chat.localId) select(chat.localId);
    else if (chat.sessionId)
      openSession({ sessionId: chat.sessionId, agent: chat.agent, title: chat.title });
  }

  function doRename(chat: DisplayChat, title: string) {
    setRenamingKey(null);
    // Server rename is a History op — only when we can reach it; otherwise the
    // local title still updates (the list is local-backed under a user token).
    if (chat.sessionId && canTenant) void history.rename(chat.sessionId, title);
    if (chat.localId) update(chat.localId, { title });
  }

  // The tile's primary destructive action: restore an archived chat, archive a
  // sent chat (soft-hide), or hard-remove an unsent draft. Without tenant reach
  // there's no archive, so just drop the local record.
  function doPrimary(chat: DisplayChat) {
    setConfirmingKey(null);
    if (canTenant && chat.archived && chat.sessionId) {
      void history.archive(chat.sessionId, false);
    } else if (canTenant && chat.sessionId) {
      void history.archive(chat.sessionId, true);
      if (chat.localId && chat.localId === activeId) select(null);
    } else if (chat.localId) {
      const local = conversations.find((c) => c.id === chat.localId);
      if (local?.forkDefName) void deleteConversationAgent(client, local.forkDefName);
      remove(chat.localId);
      if (chat.localId === activeId) select(null);
    }
  }

  const emptyMessage = history.error
    ? history.error
    : history.loading && merged.length === 0
      ? "Loading chats…"
      : showArchived
        ? "No archived chats."
        : filter.text || filter.semanticIds
          ? "No matching chats."
          : "No conversations yet.";

  return (
    <div className={collapsed ? "conv-panel collapsed" : "conv-panel"}>
      {!collapsed && (
        <div className="conv-toolbar">
          {/* Semantic search (History `related`) needs tenant reach; a title
              filter over the loaded list always works. Archive is History-only. */}
          <HistorySearch related={history.related} semantic={canTenant} onChange={setFilter} />
          {canTenant && (
            <button
              type="button"
              className={showArchived ? "conv-archived-toggle active" : "conv-archived-toggle"}
              title={showArchived ? "Show active chats" : "Show archived chats"}
              onClick={() => {
                setShowArchived((v) => !v);
                setConfirmingKey(null);
              }}
            >
              {showArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              <span>{showArchived ? "Active" : "Archived"}</span>
            </button>
          )}
        </div>
      )}

      <div className={collapsed ? "conv-tiles collapsed" : "conv-tiles"}>
        {rows.map((chat) => {
          const run = chat.sessionId ? runBySession.get(chat.sessionId) : undefined;
          const question = chat.sessionId
            ? firstPending(runIdsBySession.get(chat.sessionId), interrupts)
            : undefined;
          return (
            <ConversationTile
              key={chat.key}
              chat={chat}
              client={client}
              collapsed={collapsed}
              runState={run}
              question={question}
              active={chat.localId != null && chat.localId === activeId}
              liveRunning={chat.localId === activeId && activeStatus.running}
              liveNeedsInput={chat.localId === activeId && activeStatus.needsInput}
              confirming={confirmingKey === chat.key}
              renaming={renamingKey === chat.key}
              onSelect={() => doOpen(chat)}
              onStartRename={() => {
                setRenamingKey(chat.key);
                setConfirmingKey(null);
              }}
              onCommitRename={(t) => doRename(chat, t)}
              onCancelRename={() => setRenamingKey(null)}
              onRequestDelete={() => {
                setConfirmingKey(chat.key);
                setRenamingKey(null);
              }}
              onCancelDelete={() => setConfirmingKey(null)}
              onConfirmDelete={() => doPrimary(chat)}
            />
          );
        })}
        {rows.length === 0 && !collapsed && <p className="convo-empty">{emptyMessage}</p>}
      </div>
    </div>
  );
}
