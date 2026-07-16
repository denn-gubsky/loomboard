import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryToolInput, LoomcycleClient } from "@loomcycle/client";
import type { HistoryChat, HistoryListResponse } from "../lib/historyTypes";
import { describeError } from "../chat/lib/errors";

// Wraps the loomcycle History tool (RFC BE, v1.20.0) for the app: the per-user
// list of prior chats plus rename / archive / recap / search. The owner is
// resolved server-side from the bearer principal — `scope:"user"` keys on the
// caller's own subject; we never put an owner on the wire. The SDK returns
// `unknown` (shape varies per op), so we narrow list rows to HistoryChat here.

const LIST_LIMIT = 200;

function asChats(resp: unknown): HistoryChat[] {
  if (
    resp &&
    typeof resp === "object" &&
    Array.isArray((resp as HistoryListResponse).chats)
  ) {
    return (resp as HistoryListResponse).chats;
  }
  return [];
}

export interface UseChatHistory {
  /** Prior chats from the server, pinned-first / most-recent (server order).
   *  Includes archived rows (flagged) — the sidebar filters them client-side.
   *  Loading them always also keeps a lingering local record from re-showing an
   *  archived chat in the active view (mergeChats keys "known" off this list). */
  sessions: HistoryChat[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  rename: (sessionId: string, title: string) => Promise<void>;
  /** Soft-hide (loomcycle has no hard delete). `archived:false` restores. */
  archive: (sessionId: string, archived?: boolean) => Promise<void>;
  /** Refresh a chat's stored recap summary (live-safe, idempotent). */
  recap: (sessionId: string) => Promise<void>;
  /** Semantic match (server `related`); null when no embedder is configured.
   *  Title matching is done client-side over the loaded list (see ConversationList). */
  related: (query: string) => Promise<HistoryChat[] | null>;
}

export function useChatHistory(
  client: LoomcycleClient,
  enabled: boolean,
): UseChatHistory {
  const [sessions, setSessions] = useState<HistoryChat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest-wins: a slow list that resolves after a newer reload is discarded.
  const reqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const resp = await client.history({
        op: "list",
        scope: "user",
        include_archived: true,
        limit: LIST_LIMIT,
      });
      if (req !== reqRef.current) return; // superseded
      setSessions(asChats(resp));
    } catch (e) {
      if (req !== reqRef.current) return;
      console.warn("[history] list failed", e);
      setError(describeError(e));
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [client, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Keep the list fresh without a per-run stream: run count / summary / status
  // change server-side (incl. from other devices and the auto-recap below), and
  // the coarse run-state feed doesn't carry them. One small request a minute.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void reload(), 60_000);
    return () => clearInterval(id);
  }, [enabled, reload]);

  const rename = useCallback(
    async (sessionId: string, title: string) => {
      await client.history({ op: "rename", scope: "user", session_id: sessionId, title });
      await reload();
    },
    [client, reload],
  );

  const archive = useCallback(
    async (sessionId: string, archived = true) => {
      await client.history({ op: "archive", scope: "user", session_id: sessionId, archived });
      await reload();
    },
    [client, reload],
  );

  const recap = useCallback(
    async (sessionId: string) => {
      await client.history({ op: "recap", scope: "user", session_id: sessionId });
      await reload();
    },
    [client, reload],
  );

  const related = useCallback(
    async (query: string): Promise<HistoryChat[] | null> => {
      try {
        // `related` (semantic search) isn't in the SDK op union yet (RFC BE), so
        // pass it via a cast. It's gated on an operator embedder and refuses
        // cleanly when absent — we return null so the caller can fall back to a
        // title search rather than surfacing an error.
        const input = { op: "related", scope: "user", query } as unknown as HistoryToolInput;
        const resp = await client.history(input);
        return asChats(resp);
      } catch (e) {
        console.info("[history] semantic search unavailable, using titles", e);
        return null;
      }
    },
    [client],
  );

  return {
    sessions,
    loading,
    error,
    reload,
    rename,
    archive,
    recap,
    related,
  };
}
