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
