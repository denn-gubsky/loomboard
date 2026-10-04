// A team's OUTPUT, as the canvas shows it (RFC CZ M3b).
//
// A team's output channel is not configured anywhere — it is DERIVED: a
// channel some state publishes to and no state in this team reads. That is
// where a walk's results land for whoever consumes them outside the team (a
// person, another team, a webhook), and it is what the output panel shows.
// A channel the team both writes and reads is internal wiring, not output.
//
// Read by PEEKING, never subscribing: peek does not advance the committed
// cursor, so showing the output on a canvas cannot steal a message from the
// consumer it is actually for.
//
// Pure: no React, no network.

import type { ChannelNodeView } from "./channelNodes";

/** Channels the team publishes to and does not itself read. */
export function outputChannels(views: readonly ChannelNodeView[]): ChannelNodeView[] {
  return views.filter((v) => v.publishers.length > 0 && v.readers.length === 0);
}

/** A channel message as the canvas has it — the host maps the SDK's item. */
export interface ChannelMessage {
  id: string;
  publishedAt: string;
  value: unknown;
}

/** What to show for one output message, as PLAIN TEXT. A Starter's sink
 *  message is an envelope around the member's answer; the answer is the
 *  interesting part, so it is lifted out when present, and the rest is shown
 *  as the JSON it is. Never HTML: agent output is untrusted content to render,
 *  not markup to interpret (CLAUDE.md security rule 7). */
export function messageText(value: unknown): { text: string; status?: string; runId?: string } {
  if (typeof value === "string") return { text: value };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const status = typeof v.status === "string" ? v.status : undefined;
    const runId = typeof v.run_id === "string" ? v.run_id : undefined;
    for (const key of ["output", "final_text", "text"]) {
      if (typeof v[key] === "string") return { text: v[key] as string, status, runId };
    }
    return { text: JSON.stringify(value, null, 2), status, runId };
  }
  return { text: JSON.stringify(value, null, 2) ?? String(value) };
}

/** Newest first, at most `limit`. */
export function latestMessages(messages: readonly ChannelMessage[], limit = 10): ChannelMessage[] {
  return [...messages]
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0))
    .slice(0, limit);
}

/** The Document chunk an answer names, when it is one: its last line is a
 *  bare chunk id (32 hex digits). Teams that write to a Document answer with
 *  the id of what they wrote, sometimes after a line of preamble. */
export function chunkIdOf(text: string): string | undefined {
  const last = text.trim().split("\n").pop()?.trim() ?? "";
  return /^[0-9a-f]{32}$/.test(last) ? last : undefined;
}

/** One entry of a walk's result, as the End node shows it. */
export interface ResultItem {
  agent?: string;
  runId?: string;
  ok?: boolean;
  /** Untrusted model output: render as plain text. */
  text: string;
}

// The runtime prefixes a member's final text with the parent-transcript
// marker `[sub-agent agent_id=…]` (loomcycle gap G11). On an End node the
// answer is what matters, so that one leading line is dropped for display.
const SUB_AGENT_HEADER = /^\[sub-agent agent_id=[^\]\n]*\]\n/;

/** What a finished walk produced. A walk's final text is the output of the
 *  last state it ran (RFC DI: the run holds the output) — for a Starter, the
 *  `{results:[…]}` envelope with one entry per agent run; for any other
 *  state, plain text. */
export function walkResult(finalText?: string): ResultItem[] {
  const raw = (finalText ?? "").trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const results =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as { results?: unknown }).results
        : undefined;
    if (Array.isArray(results)) {
      return results.map((r) => {
        const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
        const text = typeof o.output === "string" && o.output ? o.output : typeof o.error === "string" ? o.error : "";
        return {
          agent: typeof o.agent === "string" ? o.agent : undefined,
          runId: typeof o.run_id === "string" ? o.run_id : undefined,
          ok: typeof o.ok === "boolean" ? o.ok : undefined,
          text: text.replace(SUB_AGENT_HEADER, ""),
        };
      });
    }
  } catch {
    // Not JSON: an agent state's plain answer — which carries the same marker.
  }
  return [{ text: raw.replace(SUB_AGENT_HEADER, "") }];
}
