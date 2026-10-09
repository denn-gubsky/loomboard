import { useCallback, useEffect, useState } from "react";
import type { ChannelNodeView } from "./lib/channelNodes";
import { latestMessages, messageText, type ChannelMessage } from "./lib/output";
import { localRef } from "./lib/teamLocal";

// The team's OUTPUT (RFC CZ M3b): the latest messages on each channel the team
// publishes to and does not itself read (lib/output.ts outputChannels).
//
// Peeked, never subscribed, so showing them cannot consume a message meant for
// someone else. Refreshed when `refreshKey` changes — the canvas bumps it when
// a run in the walk settles, which is when new output can appear — and on
// demand. Message content is agent output: rendered as plain text.
//
// One of the team's OWN channels (`./name`, RFC DV) cannot be peeked like
// the others: the runtime keeps it out of the channel listing and refuses a
// peek by its name. It is read through the team instead (`peekTeamChannel`,
// loomcycle 1.108), once the SAVED team declares it. Without that — an older
// host, a team not saved yet, a channel only the draft has — the row says why
// there is nothing to show, as a note rather than an error.

export interface OutputPanelProps {
  channels: ChannelNodeView[];
  peekChannel: (channel: string, opts: { scope: string; max?: number }) => Promise<ChannelMessage[]>;
  /** Reads one of the team's own channels by its local name. Absent when the
   *  host cannot, or the team is not stored yet. */
  peekTeamChannel?: (name: string, opts: { max?: number }) => Promise<ChannelMessage[]>;
  /** True once the saved team's own channels were listed: only then does a
   *  channel's absence from the listing mean the saved team lacks it. */
  teamChannelsListed?: boolean;
  refreshKey?: string;
  max?: number;
}

/** Why one of the team's own channels has nothing to show, or undefined when
 *  it can be read. */
function ownChannelNote(c: ChannelNodeView, canPeek: boolean, listed: boolean): string | undefined {
  if (localRef(c.channel) === undefined) return undefined;
  if (!canPeek) return "The team's own channel. Only this team's walks and its own agents can read it, so its messages cannot be shown here.";
  // The runtime lists what the SAVED team declares; a channel only the draft
  // has is not there yet. When the listing itself is missing, nothing is
  // known about that, and the peek's own answer is shown instead.
  if (listed && !c.info) return "The team's own channel. The saved team does not declare it yet: save the team, and what it publishes here will show.";
  return undefined;
}

export function OutputPanel({ channels, peekChannel, peekTeamChannel, teamChannelsListed, refreshKey, max = 5 }: OutputPanelProps) {
  const [byChannel, setByChannel] = useState<Record<string, ChannelMessage[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // `channels` must be stable between renders (the canvas memoizes it), or
  // every render would re-peek.
  const refresh = useCallback(async () => {
    setBusy(true);
    const nextMsgs: Record<string, ChannelMessage[]> = {};
    const nextErr: Record<string, string> = {};
    await Promise.all(
      channels.map(async (c) => {
        const local = localRef(c.channel);
        if (local !== undefined) {
          if (!peekTeamChannel || ownChannelNote(c, true, !!teamChannelsListed)) return;
          try {
            nextMsgs[c.channel] = latestMessages(await peekTeamChannel(local, { max: 50 }), max);
          } catch (e) {
            nextErr[c.channel] = e instanceof Error ? e.message : String(e);
          }
          return;
        }
        // Peeking needs the channel's declared scope; one the runtime has not
        // listed cannot be addressed, and saying so beats guessing a scope.
        const scope = c.info?.scope;
        if (!scope) {
          nextErr[c.channel] = c.declared === false ? "not declared on this runtime" : "scope unknown — channel list not loaded";
          return;
        }
        try {
          nextMsgs[c.channel] = latestMessages(await peekChannel(c.channel, { scope, max: 50 }), max);
        } catch (e) {
          nextErr[c.channel] = e instanceof Error ? e.message : String(e);
        }
      }),
    );
    setByChannel(nextMsgs);
    setErrors(nextErr);
    setBusy(false);
  }, [channels, peekChannel, peekTeamChannel, teamChannelsListed, max]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  if (!channels.length) return null;
  return (
    <section className="lb-wf-output" aria-label="Team output">
      <header className="lb-wf-output__head">
        <strong>Output</strong>
        <span className="lb-wf-team__hint">
          {" "}— what the team publishes and does not itself read; peeked, never consumed
        </span>
        <span className="lb-wf-toolbar__spacer" />
        <button type="button" className="lb-wf-btn" onClick={() => void refresh()} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {channels.map((c) => {
        const msgs = byChannel[c.channel] ?? [];
        return (
          <div key={c.channel} className="lb-wf-output__channel" data-testid={`output-${c.channel}`}>
            <div className="lb-wf-output__name">
              <code>{c.channel}</code>
              {c.info?.scope ? <span className="lb-wf-team__hint"> · {c.info.scope}</span> : null}
              {localRef(c.channel) !== undefined && peekTeamChannel ? <span className="lb-wf-team__hint"> · the team's own</span> : null}
            </div>
            {ownChannelNote(c, !!peekTeamChannel, !!teamChannelsListed) ? (
              <p className="lb-wf-team__hint">{ownChannelNote(c, !!peekTeamChannel, !!teamChannelsListed)}</p>
            ) : errors[c.channel] ? (
              <div className="lb-wf-finding lb-wf-finding--error">{errors[c.channel]}</div>
            ) : msgs.length === 0 ? (
              <p className="lb-wf-team__hint">No messages yet.</p>
            ) : (
              <ol className="lb-wf-output__list">
                {msgs.map((m) => {
                  const { text, status, runId } = messageText(m.value);
                  return (
                    <li key={m.id} className="lb-wf-output__msg">
                      <div className="lb-wf-runs__meta">
                        {m.publishedAt}
                        {status ? ` · ${status}` : ""}
                        {runId ? ` · ${runId}` : ""}
                      </div>
                      <pre className="lb-wf-runs__text">{text}</pre>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </section>
  );
}
