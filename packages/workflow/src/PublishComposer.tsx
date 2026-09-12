import { useMemo, useState } from "react";
import { publishPreflight } from "./lib/publish";
import type { ChannelInfo } from "./types";

// The publish composer — RFC CZ decision C7.
//
// Publishing to the entry Starter's source channel is how an SDLC run actually
// starts: send an RFP document path to `sdlc-intake` and the architect wave
// dispatches. That makes this the primary Run affordance for a Starter-fronted
// workflow, not a debugging convenience.
//
// Almost all of the value is in lib/publish.ts's pre-flight, which is why it is
// a separate pure module: every way a publish can silently fail to start a run
// looks identical at the moment of sending — the message is accepted, a msg_id
// comes back, and nothing happens.

export interface PublishComposerProps {
  channel: string;
  info?: ChannelInfo;
  channelsLoaded: boolean;
  loadedDefId?: string;
  activeDefId?: string;
  disabled?: boolean;
  onPublish: (payload: unknown, scope: string) => Promise<void>;
  onClose: () => void;
}

export function PublishComposer({
  channel,
  info,
  channelsLoaded,
  loadedDefId,
  activeDefId,
  disabled,
  onPublish,
  onClose,
}: PublishComposerProps) {
  const [payloadText, setPayloadText] = useState('{\n  "path": ""\n}');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string>();
  const [error, setError] = useState<string>();

  const pre = useMemo(
    () =>
      publishPreflight({ channel, info, channelsLoaded, loadedDefId, activeDefId, payloadText }),
    [channel, info, channelsLoaded, loadedDefId, activeDefId, payloadText],
  );

  // No `canPublish` re-check here: the button below is the single gate, and a
  // second guard was unreachable — mutation-testing it changed nothing, which
  // is the tell. `disabled` and `canPublish` derive from the same render, so
  // there is no state in which a click gets past one and not the other.
  const publish = async () => {
    setBusy(true);
    setError(undefined);
    setSent(undefined);
    try {
      // `scope` comes from the channel's own declaration via the pre-flight.
      // Defaulting it here would be the bug the pre-flight exists to catch.
      await onPublish(pre.payload, pre.scope ?? "");
      setSent("Published.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lb-wf-publish" aria-label="Publish to channel">
      <header className="lb-wf-publish__head">
        <strong>
          Publish to <code>{channel || "—"}</code>
        </strong>
        {info?.scope && <span className="lb-wf-publish__scope">scope: {info.scope}</span>}
        <span className="lb-wf-toolbar__spacer" />
        <button className="lb-wf-btn" onClick={onClose}>
          Close
        </button>
      </header>

      <label className="lb-wf-field">
        <span className="lb-wf-field__label">Message (JSON)</span>
        <textarea
          className="lb-wf-input lb-wf-publish__payload"
          rows={5}
          spellCheck={false}
          disabled={disabled || busy}
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
        />
      </label>

      {pre.issues.length > 0 && (
        <ul className="lb-wf-publish__issues">
          {pre.issues.map((i, n) => (
            <li key={n} className={`lb-wf-finding lb-wf-finding--${i.level === "block" ? "error" : "info"}`}>
              {i.message}
            </li>
          ))}
        </ul>
      )}

      {error && <div className="lb-wf-error">{error}</div>}
      {sent && <div className="lb-wf-badge lb-wf-badge--ok">{sent}</div>}

      <button
        className="lb-wf-btn lb-wf-btn--primary"
        onClick={publish}
        disabled={disabled || busy || !pre.canPublish}
      >
        {busy ? "Publishing…" : "Publish"}
      </button>
    </section>
  );
}
