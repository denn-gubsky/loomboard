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

// loomcycle's own maintenance agents (config `internal: true`) create sessions
// that are runtime bookkeeping, not conversations — memory extraction /
// consolidation. The server History list hides them by default, but sessions
// from before an agent was marked internal (or an instance that didn't) leak
// through, so we also guard here. Keep this to the exact known service agents so
// a user's legitimately-named chat is never hidden.
const INTERNAL_AGENTS = new Set(["memory/extractor", "memory/consolidator"]);

export function isInternalAgent(agent: string): boolean {
  return INTERNAL_AGENTS.has(agent);
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
    if (isInternalAgent(s.agent)) continue; // runtime bookkeeping, not a chat
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
