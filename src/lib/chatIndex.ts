import type { Conversation } from "../state/conversations";
import type { HistoryChat, HistoryChatStatus } from "./historyTypes";

// Merge the server-side History chat list with the local conversation store into
// one display list for the left panel. Rules:
//  - a server session is the authority for a SENT chat (title/summary/status);
//    a matching local conversation (by sessionId) supplies the agent/config used
//    to CONTINUE it.
//  - a local conversation with no sessionId is an unsent DRAFT → its own row.
//  - a local SENT chat missing from the loaded server page (just created, or
//    beyond the page) is still shown from local data, so the active chat never
//    vanishes while History is loading.
// Pure → unit-tested.

export interface DisplayChat {
  /** Stable React key. sessionId when sent, else the local draft id. */
  key: string;
  sessionId?: string;
  /** Local Conversation id, when we have one (for select + config on continue). */
  localId?: string;
  title: string;
  /** Agent name — drives identity (icon/color) and the fallback label. */
  agent: string;
  summary?: string;
  status?: HistoryChatStatus;
  pinned: boolean;
  /** Soft-hidden on the server. Shown only in the Archived view; restorable. */
  archived: boolean;
  runCount: number;
  /** ms since epoch, for sort. */
  lastActivity: number;
  source: "server" | "draft";
}

function ms(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? fallback : t;
}

export function mergeChats(
  sessions: HistoryChat[],
  locals: Conversation[],
): DisplayChat[] {
  const localBySession = new Map<string, Conversation>();
  for (const c of locals) if (c.sessionId) localBySession.set(c.sessionId, c);
  // Every session id the server told us about — so a local record can't emit a
  // duplicate row for a chat the server already listed (incl. an archived one).
  const known = new Set(sessions.map((s) => s.session_id));

  const out: DisplayChat[] = [];

  // Archived rows are kept (flagged) so the Archived view can list + restore
  // them; the default view filters them out at the call site. The server only
  // returns archived rows when asked (include_archived), so normally there are
  // none here anyway.
  for (const s of sessions) {
    const local = localBySession.get(s.session_id);
    out.push({
      key: s.session_id,
      sessionId: s.session_id,
      localId: local?.id,
      title: s.title || local?.title || "Untitled chat",
      agent: local?.baseAgent || s.agent || "",
      summary: s.summary,
      status: s.status,
      pinned: Boolean(s.pinned),
      archived: Boolean(s.archived),
      runCount: s.run_count,
      lastActivity: ms(s.last_activity, ms(s.created_at, 0)),
      source: "server",
    });
  }

  for (const c of locals) {
    if (c.sessionId && known.has(c.sessionId)) continue; // already emitted
    out.push({
      key: c.sessionId ?? c.id,
      sessionId: c.sessionId,
      localId: c.id,
      title: c.title || "New chat",
      agent: c.baseAgent || "",
      pinned: false,
      archived: false,
      runCount: 0,
      lastActivity: c.updatedAt,
      source: c.sessionId ? "server" : "draft",
    });
  }

  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastActivity - a.lastActivity;
  });
  return out;
}

/** Whether the active chat is due a fresh recap: it's long enough to be worth
 *  summarizing and has had new turns since we last recapped it. Staleness is
 *  keyed on `runCount` (monotonic — a recap can't add a run) rather than
 *  `last_activity`, so a recap that bumps activity can't trigger another recap.
 *  `lastRecapRunCount` is the run count we recapped at previously (0 if never). */
export function shouldRecap(
  chat: { runCount: number },
  lastRecapRunCount: number,
  minRuns = 3,
): boolean {
  if (chat.runCount < minRuns) return false;
  return chat.runCount > lastRecapRunCount;
}
