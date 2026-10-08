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
// One of the team's OWN channels (`./name`, RFC DV) is listed and never
// peeked: the runtime lets only the team's walks and its own agents read it —
// it is in no channel listing and a peek from outside is refused — so there
// is nothing this panel can fetch, and it says that instead of an error.

export interface OutputPanelProps {
  channels: ChannelNodeView[];
  peekChannel: (channel: string, opts: { scope: string; max?: number }) => Promise<ChannelMessage[]>;
  refreshKey?: string;
  max?: number;
}

export function OutputPanel({ channels, peekChannel, refreshKey, max = 5 }: OutputPanelProps) {
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
        if (localRef(c.channel) !== undefined) return;
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
  }, [channels, peekChannel, max]);

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
            </div>
            {localRef(c.channel) !== undefined ? (
              <p className="lb-wf-team__hint">
                The team's own channel. Only this team's walks and its own agents can read it, so its messages cannot be
                shown here — and no state of the team reads it.
              </p>
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
