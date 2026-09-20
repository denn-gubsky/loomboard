import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import type { InterruptRow } from "@loomcycle/client";
import { useConversations } from "../state/conversations";
import { useActiveChat } from "../state/activeChat";
import { useConnection, useLoomcycle } from "../state/connection";
import { deleteConversationAgent } from "../chat/lib/legacyFork";
import { useUserRunStates } from "../hooks/useUserRunStates";
import { useUserInterrupts } from "../hooks/useUserInterrupts";
import { useChatHistory } from "../hooks/useChatHistory";
import { useAutoRecap } from "../hooks/useAutoRecap";
import { isChatAgent, mergeChats, type DisplayChat } from "../lib/chatIndex";
import { nextIdleStamp, NO_IDLE } from "../lib/recapIdle";
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
  const { principal } = useConnection();
  const userId = principal?.subject ?? null;

  // RFC BY (loomcycle 1.51): /v1/_history is member-readable, capped server-side
  // to the caller's own [self, user] scope — so a delegated user token gets its
  // OWN chat list, rename, archive, recap and search, same as an operator.
  const history = useChatHistory(client, Boolean(userId));
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

  const activeSessionId = conversations.find((c) => c.id === activeId)?.sessionId;
  const activeChat = activeSessionId
    ? merged.find((c) => c.sessionId === activeSessionId)
    : undefined;

  // Publish the active chat's recap to the main pane (it renders it as a ghost
  // message — the tile has no room). null clears it when there's no active chat.
  useEffect(() => {
    setRecap(activeChat?.summary ?? null);
  }, [activeChat?.summary, setRecap]);

  // Auto-recap the active chat when it sits idle for 3 min (see useAutoRecap).
  // The idle clock is stamped from <Chat>'s working→quiet transition rather than
  // the History row's last_activity: a steered chat keeps ONE run for its whole
  // life, so last_activity is frozen at that run's start and the timer armed
  // only once (see lib/recapIdle).
  const [idle, setIdle] = useState(NO_IDLE);
  useEffect(() => {
    setIdle((prev) => nextIdleStamp(prev, activeSessionId, activeStatus.running, Date.now()));
  }, [activeSessionId, activeStatus.running]);

  useAutoRecap({
    sessionId: activeSessionId,
    idleSince: idle.at,
    recap: history.recap,
  });

  const [showArchived, setShowArchived] = useState(false);
  // Off by default: the list is the user's CHATS, and loomcycle gives a session
  // to plenty of non-chat work (team members, board-spawned agents) that would
  // otherwise crowd it out. Ticking this shows every session in scope.
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [filter, setFilter] = useState<ChatFilter>(NO_FILTER);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    let r = merged.filter((c) => (showArchived ? c.archived : !c.archived));
    if (!showAllAgents) r = r.filter((c) => isChatAgent(c.agent));
    if (filter.semanticIds) {
      const order = new Map(filter.semanticIds.map((id, i) => [id, i] as const));
      r = r
        .filter((c) => c.sessionId && order.has(c.sessionId))
        .sort((a, b) => order.get(a.sessionId!)! - order.get(b.sessionId!)!);
    } else if (filter.text) {
      r = r.filter((c) => c.title.toLowerCase().includes(filter.text));
    }
    return r;
  }, [merged, showArchived, showAllAgents, filter]);

  function doOpen(chat: DisplayChat) {
    setConfirmingKey(null);
    setRenamingKey(null);
    if (chat.localId) select(chat.localId);
    else if (chat.sessionId)
      openSession({ sessionId: chat.sessionId, agent: chat.agent, title: chat.title });
  }

  function doRename(chat: DisplayChat, title: string) {
    setRenamingKey(null);
    if (chat.sessionId) {
      void history.rename(chat.sessionId, title);
      if (chat.localId) update(chat.localId, { title }); // keep the local mirror in sync
    } else if (chat.localId) {
      update(chat.localId, { title });
    }
  }

  // The tile's primary destructive action: restore an archived chat, archive a
  // sent chat (soft-hide), or hard-remove an unsent draft.
  function doPrimary(chat: DisplayChat) {
    setConfirmingKey(null);
    if (chat.archived && chat.sessionId) {
      void history.archive(chat.sessionId, false);
    } else if (chat.sessionId) {
      void history.archive(chat.sessionId, true);
      if (chat.localId && chat.localId === activeId) select(null);
    } else if (chat.localId) {
      const local = conversations.find((c) => c.id === chat.localId);
      if (local?.forkDefName) void deleteConversationAgent(client, local.forkDefName);
      remove(chat.localId);
    }
  }

  // Hidden-by-the-agent-filter is its own empty state: without it a list full of
  // non-chat sessions reads as "you have nothing", with no hint that the box
  // one line above is what's hiding them.
  const hiddenByAgentFilter =
    !showAllAgents &&
    merged.some((c) => (showArchived ? c.archived : !c.archived) && !isChatAgent(c.agent));

  const emptyMessage = history.error
    ? history.error
    : history.loading && merged.length === 0
      ? "Loading chats…"
      : filter.text || filter.semanticIds
        ? "No matching chats."
        : hiddenByAgentFilter
          ? "No chat agents here — tick “All agents” to show other sessions."
          : showArchived
            ? "No archived chats."
            : "No conversations yet.";

  return (
    <div className={collapsed ? "conv-panel collapsed" : "conv-panel"}>
      {!collapsed && (
        <div className="conv-toolbar">
          <HistorySearch related={history.related} onChange={setFilter} />
          <div className="conv-toolbar-row">
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
            <label
              className="conv-allagents-toggle"
              title="Also list sessions run by non-chat agents (teams, boards, tools)"
            >
              <input
                type="checkbox"
                checked={showAllAgents}
                onChange={(e) => {
                  setShowAllAgents(e.target.checked);
                  setConfirmingKey(null);
                }}
              />
              <span>All agents</span>
            </label>
          </div>
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
