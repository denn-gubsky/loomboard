// Local types for the loomcycle History tool (RFC BE, v1.20.0). The SDK's
// `client.history()` returns `unknown` (the shape varies per op), so we mirror
// the server's `SessionSummary` / list envelope here and narrow at the call site.

export type HistoryChatStatus = "running" | "completed" | "failed" | "cancelled";

/** One prior chat (session) as returned by History `list`/`search` rows. Keys
 *  match the server JSON (snake_case). A "chat" is a session that may span runs. */
export interface HistoryChat {
  session_id: string;
  agent: string;
  created_at: string;
  last_activity: string;
  run_count: number;
  title?: string;
  description?: string;
  tags?: string[];
  pinned?: boolean;
  archived?: boolean;
  summary?: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  status?: HistoryChatStatus;
}

/** Envelope for History `list`/`search`/`related`. */
export interface HistoryListResponse {
  scope: string;
  chats: HistoryChat[];
  total: number;
}
