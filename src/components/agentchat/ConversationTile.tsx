import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, Check, Pencil, Trash2, X } from "lucide-react";
import type { InterruptRow, LoomcycleClient } from "@loomcycle/client";
import type { DisplayChat } from "../../lib/chatIndex";
import { agentIdentity } from "../../lib/agentIdentity";
import { tileDisplayState, type RunTile, type TileDisplayState } from "../../lib/runStates";
import { useInView, useTilePreview } from "../../hooks/useTilePreview";
import type { PreviewLine } from "../../lib/tilePreview";
import AgentChatTile from "./AgentChatTile";

// A minimized view of one prior chat for the sidebar. A chat comes from the merge
// of History (server, authoritative title/summary/status) and the local store
// (agent/config for continuing). Identity keys off the agent; the LABEL is the
// renamable title. Live state joins the aggregate run-state feed by sessionId +
// pending question. Delete archives a sent chat (reversible) or drops a draft.
export default function ConversationTile({
  chat,
  client,
  collapsed,
  runState,
  question,
  active,
  liveRunning,
  confirming,
  renaming,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  chat: DisplayChat;
  client: LoomcycleClient;
  collapsed: boolean;
  runState?: RunTile;
  question?: InterruptRow;
  active: boolean;
  /** The active chat's agent is working now (from <Chat>) — authoritative over
   *  the aggregate feed, which lags a run started this session. */
  liveRunning?: boolean;
  confirming: boolean;
  renaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const label = chat.title || chat.agent || "New chat";
  const identity = useMemo(
    () => agentIdentity(chat.agent || chat.title || chat.key),
    [chat.agent, chat.title, chat.key],
  );

  const [ref, inView] = useInView<HTMLDivElement>();
  // Poll the transcript so the preview stays live and visibly scrolls (the
  // aggregate feed carries no text). While a run is generating — but ALSO always
  // for the ACTIVE chat: a run started this session usually isn't in the
  // aggregate feed yet, so `runState` is undefined and "running" can't be
  // trusted, and the active chat is the one the user is watching. Gated on
  // in-view + expanded so off-screen / collapsed tiles cost nothing.
  const live = runState?.status === "running";
  const poll = (live || active) && !collapsed && inView;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!poll) return;
    const id = setInterval(() => setTick((t) => t + 1), 2500);
    return () => clearInterval(id);
  }, [poll]);
  // Refetch on run transition or each poll tick; string key so a not-started
  // chat (no runState) still has a stable key.
  const refreshKey = `${runState?.ts ?? chat.lastActivity}:${tick}`;
  const { lines, loading } = useTilePreview(
    client,
    chat.sessionId,
    refreshKey,
    inView && !collapsed,
    3,
  );

  // A pending question wins (needs input); else the live "working" signal from
  // the active <Chat> (authoritative, and immediate) makes the dot pulse; else
  // fall back to the aggregate feed; else idle.
  const state: TileDisplayState = question
    ? "needs_input"
    : liveRunning
      ? "running"
      : runState
        ? tileDisplayState(runState, false)
        : "idle";
  const alert =
    runState?.status === "failed" ? runState.error || "run failed" : undefined;

  // A live transcript is the freshest signal; when the chat is idle and has a
  // stored recap, show that instead — it's the point of the summary in the list.
  const summaryLine: PreviewLine[] =
    chat.summary && state !== "running" && lines.length === 0
      ? [{ role: "assistant", kind: "notice", text: chat.summary }]
      : [];
  const preview = lines.length > 0 ? lines : summaryLine;

  if (collapsed) {
    const { Icon } = identity;
    return (
      <button
        type="button"
        className={active ? "convtile-mini active" : "convtile-mini"}
        style={{ ["--tile-accent" as string]: identity.color }}
        onClick={onSelect}
        title={label}
      >
        <span className="act-avatar" aria-hidden>
          <Icon size={16} />
        </span>
        <span className={`act-dot dot-${state}`} aria-hidden />
        {(question || alert) && <span className="convtile-mini-flag" aria-hidden />}
      </button>
    );
  }

  if (renaming) {
    return (
      <div className={active ? "convtile active" : "convtile"}>
        <RenameForm
          initial={chat.title}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      </div>
    );
  }

  // A draft (no session) is removed outright; a sent chat is archived (soft-hide,
  // reversible). An already-archived row's primary action is Restore.
  const primaryLabel = chat.archived
    ? "Restore chat"
    : chat.sessionId
      ? "Archive chat"
      : "Delete chat";

  return (
    <div ref={ref} className={active ? "convtile active" : "convtile"}>
      <AgentChatTile
        agentName={label}
        Icon={identity.Icon}
        accentColor={identity.color}
        state={state}
        preview={preview}
        loadingPreview={loading && preview.length === 0}
        alert={alert}
        question={question ? question.question || "The agent is asking for input." : undefined}
        questionPriority={question?.priority}
        onOpen={onSelect}
      />
      {confirming ? (
        <span className="convtile-confirm">
          <button
            className="convtile-del confirm"
            title={`Confirm — ${primaryLabel.toLowerCase()}`}
            aria-label={`Confirm ${primaryLabel.toLowerCase()}`}
            onClick={(e) => {
              e.stopPropagation();
              onConfirmDelete();
            }}
          >
            <Check size={13} />
          </button>
          <button
            className="convtile-del cancel"
            title="Cancel"
            aria-label="Cancel"
            onClick={(e) => {
              e.stopPropagation();
              onCancelDelete();
            }}
          >
            <X size={13} />
          </button>
        </span>
      ) : (
        <span className="convtile-actions">
          {!chat.archived && (
            <button
              className="convtile-del"
              title="Rename chat"
              aria-label="Rename chat"
              onClick={(e) => {
                e.stopPropagation();
                onStartRename();
              }}
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            className="convtile-del"
            title={primaryLabel}
            aria-label={primaryLabel}
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
          >
            {chat.archived ? <ArchiveRestore size={13} /> : <Trash2 size={13} />}
          </button>
        </span>
      )}
    </div>
  );
}

// Uncontrolled so a title refresh mid-edit can't clobber the field; committed on
// Enter / ✓, cancelled on Escape / ✕. Not on blur — blur races the ✓ click.
function RenameForm({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      className="convtile-rename"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        const v = ref.current?.value.trim();
        if (v) onCommit(v);
        else onCancel();
      }}
    >
      <input
        ref={ref}
        defaultValue={initial}
        autoFocus
        aria-label="Chat title"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="submit" className="convtile-del confirm" title="Save" aria-label="Save">
        <Check size={13} />
      </button>
      <button
        type="button"
        className="convtile-del cancel"
        title="Cancel"
        aria-label="Cancel"
        onClick={onCancel}
      >
        <X size={13} />
      </button>
    </form>
  );
}
