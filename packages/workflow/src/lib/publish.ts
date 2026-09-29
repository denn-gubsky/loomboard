// The publish composer's pre-flight. RFC CZ decision C7.
//
// WHY this is more than "type JSON and hit send": publishing to a channel is
// how an SDLC run actually starts, and every way it can silently fail to start
// one is invisible at the moment of sending. The message is accepted, a msg_id
// comes back, and nothing happens. Each check below is one of those.
//
// The failure shapes, in the order they bite:
//
//   not declared      the runtime refuses a channel with no declaration, so the
//                     publish itself errors — better to say so first.
//   scope=agent       a walk resolves a channel at the CHANNEL's declared
//                     scope, and refuses agent scope outright: "a starter reads
//                     on the WALK's behalf, not as one agent". The publish
//                     succeeds and the Starter never sees it.
//   hold              ChannelDef.Hold stores publishes and delivers none until
//                     released. Accepted, queued, inert.
//   hooks             the channel's own channel_publish hooks (RFC DK D6) see
//                     every message first: it is stored invisible and
//                     delivered only if they release it — possibly rewritten,
//                     possibly dropped, possibly held for a person.
//   a backlog         a per-message Starter fans out over what is ALREADY on
//                     the channel, not just the message being sent. Publishing
//                     one message to a channel holding forty starts a wave of
//                     forty-one, bounded only by fanout.max.
//   editing ≠ promoted  a publish reaches the PROMOTED version through its armed
//                     subscription. The graph on screen may not be it.
//
// Pure: no React, no network.

import type { ChannelInfo, PublishOutcome } from "../types";

export type IssueLevel = "block" | "warn";

export interface PublishIssue {
  level: IssueLevel;
  message: string;
}

export interface PreflightInput {
  channel: string;
  /** The channel's declaration, if the host could list it. */
  info?: ChannelInfo;
  /** True once the channel list has loaded — an absent `info` means "not
   *  declared" only when we actually looked. */
  channelsLoaded: boolean;
  /** The def_id the canvas has open. */
  loadedDefId?: string;
  /** The team's promoted pointer. */
  activeDefId?: string;
  payloadText: string;
}

export interface Preflight {
  issues: PublishIssue[];
  /** Parsed payload, present only when it parsed. */
  payload?: unknown;
  /** The scope to publish at, from the channel's own declaration. */
  scope?: string;
  canPublish: boolean;
}

/** Scopes a team workflow can actually read. Mirrors teamChannelIO.resolve. */
const WALK_READABLE = ["global", "tenant", "user"];

export function publishPreflight(input: PreflightInput): Preflight {
  const issues: PublishIssue[] = [];
  const block = (message: string) => issues.push({ level: "block", message });
  const warn = (message: string) => issues.push({ level: "warn", message });

  if (!input.channel.trim()) {
    block("This workflow's entry state reads no channel, so there is nothing to publish to.");
    return { issues, canPublish: false };
  }

  // ---- payload ----
  let payload: unknown;
  const text = input.payloadText.trim();
  if (!text) {
    block("Enter a JSON payload.");
  } else {
    try {
      payload = JSON.parse(text);
    } catch (e) {
      block(`Payload is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- the channel itself ----
  const info = input.info;
  if (input.channelsLoaded && !info) {
    block(
      `Channel "${input.channel}" is not declared. The runtime refuses an undeclared channel, ` +
        "so this publish would fail — declare it in operator yaml or with ChannelDef first.",
    );
  }

  const scope = info?.scope;
  if (info) {
    if (scope && !WALK_READABLE.includes(scope)) {
      block(
        `Channel "${input.channel}" is scope=${scope}, which a team workflow cannot read — ` +
          "a starter reads on the walk's behalf, not as one agent. The publish would succeed " +
          "and the Starter would never see it.",
      );
    } else if (!scope) {
      warn("This channel declares no scope, so where the message lands cannot be checked here.");
    }

    if (info.hold) {
      warn(
        "This channel is HELD: the message will be stored and delivered to nobody until the " +
          "hold is released. Nothing will run yet.",
      );
    }

    const hooks = info.hooks ?? [];
    if (hooks.length) {
      warn(
        `This channel carries hook${hooks.length === 1 ? "" : "s"} (${hooks.join(", ")}). Your ` +
          "message is stored and delivered only if they release it — they may rewrite it, drop " +
          "it, or hold it for a person — so the Starter may not see it, or may not see it yet.",
      );
    }

    // message_count counts EVERYTHING stored, including messages a reader
    // cannot see yet (held, or awaiting the channel's hooks). The wave widens
    // over what a Starter can actually read, so only those count here.
    const hidden = (info.held_count ?? 0) + (info.awaiting_hooks_count ?? 0);
    const backlog = Math.max(0, (info.message_count ?? 0) - hidden);
    if (backlog > 0) {
      warn(
        `${backlog} message${backlog === 1 ? "" : "s"} already queued here. A Starter with ` +
          "per=message fans out over the backlog too, so the wave will be wider than the one " +
          "message you are sending (up to its max).",
      );
    }
  }

  // ---- which version will actually run ----
  if (input.loadedDefId && input.activeDefId && input.loadedDefId !== input.activeDefId) {
    warn(
      "A publish reaches the PROMOTED version through its armed subscription, and the graph on " +
        `screen (${input.loadedDefId}) is not it (${input.activeDefId}). Promote this version ` +
        "first if you meant to run what you are looking at.",
    );
  }

  return {
    issues,
    payload,
    scope,
    canPublish: !issues.some((i) => i.level === "block"),
  };
}

/** What to tell the operator once a publish returns. "Published" is only true
 *  when the message is visible to readers now; a hold or a hooked channel
 *  STORES it without delivering it, and saying "published" there is the
 *  silent-failure shape this module exists to prevent. */
export function publishOutcomeMessage(outcome: PublishOutcome | void): string {
  const r = outcome ?? {};
  const parts: string[] = [];
  if (r.awaiting_hooks) {
    parts.push("Stored, waiting for the channel's hooks — delivered only if they release it.");
  }
  if (r.held) parts.push("Stored, held — delivered to nobody until the hold is released.");
  if (!parts.length) parts.push("Published.");
  const dropped = r.dropped_oldest ?? 0;
  if (dropped > 0) {
    parts.push(
      `The channel was full: ${dropped} older message${dropped === 1 ? " was" : "s were"} ` +
        "trimmed to make room.",
    );
  }
  return parts.join(" ");
}
