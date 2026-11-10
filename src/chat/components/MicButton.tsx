import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Loader2, Mic, RotateCcw, Square, X } from "lucide-react";
import type { VoiceInput } from "../hooks/useVoiceInput";
import { languageName } from "../lib/voiceInput";
import { SEND_DELAY_MS } from "../lib/pushToTalk";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Seconds since `since`, ticking while a recording runs.
function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? 0 : Math.max(0, (now - since) / 1000);
}

// The microphone's loudness, 0..1, so the user sees it is hearing them.
function useLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      void ctx.close();
      setLevel(0);
    };
  }, [stream]);
  return level;
}

interface SendWindow {
  /** When a held take's transcript is sent (Composer), or null. */
  sendAt: number | null;
  onCancelSend(): void;
}

/** The composer's microphone button (RFC FX §7.1). Hold to talk: recording
 *  starts on the press, and a release over the mic transcribes and sends after
 *  a short window. A tap dictates hands-free into the draft until the next
 *  tap. Release off the mic discards. One element throughout, so pointer
 *  capture survives the state changes a press causes. */
export function MicButton({ voice, disabled, sendAt, onCancelSend }: { voice: VoiceInput; disabled: boolean } & SendWindow) {
  const { status } = voice.state;
  const [holding, setHolding] = useState(false);
  const pressed = useRef(false);
  // The click a Space keyup may still produce: the keys already handled it.
  const spaceUp = useRef(false);

  if (voice.unavailable) {
    return (
      <button type="button" className="mic-btn" disabled title={voice.unavailable} aria-label={voice.unavailable}>
        <Mic size={18} />
      </button>
    );
  }

  const idle = sendAt === null && (status === "idle" || status === "error");
  const begin = () => {
    if (sendAt !== null) return onCancelSend();
    // Chrome still sends pointer events to a disabled button, unlike clicks.
    if (idle && disabled) return;
    pressed.current = true;
    setHolding(status === "idle" || status === "error");
    voice.press();
  };
  const end = (inside: boolean) => {
    if (!pressed.current) return;
    pressed.current = false;
    setHolding(false);
    voice.release(inside);
  };

  let label: string;
  let icon: ReactNode;
  let cls = "mic-btn";
  if (sendAt !== null) {
    label = "Cancel send";
    cls += " sending";
    icon = (
      <>
        <svg className="mic-ring" viewBox="0 0 32 32" aria-hidden key={sendAt}>
          <circle cx="16" cy="16" r="14" style={{ animationDuration: `${Math.max(0, sendAt - Date.now())}ms` }} />
        </svg>
        <X size={16} />
      </>
    );
  } else if (status === "recording") {
    label = holding ? "Release to send" : "Stop and transcribe";
    cls += " recording";
    icon = holding ? <Mic size={18} /> : <Square size={14} />;
  } else if (status === "starting" || status === "transcribing") {
    label = "Cancel voice input";
    icon = <Loader2 size={18} className="spin" />;
  } else {
    label = "Voice input";
    icon = <Mic size={18} />;
  }
  const lang = voice.language ? ` (${voice.language})` : "";

  return (
    <button
      type="button"
      className={cls}
      disabled={idle && disabled}
      title={idle ? `Hold to talk and send; tap to dictate${lang}` : label}
      aria-label={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        begin();
      }}
      onPointerUp={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        end(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
      }}
      // The press was taken away (a permission prompt, a scroll on touch).
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(false)}
      onKeyDown={(e) => {
        if (e.key !== " ") return;
        e.preventDefault();
        if (!e.repeat && !pressed.current) begin();
      }}
      onKeyUp={(e) => {
        if (e.key !== " ") return;
        e.preventDefault();
        spaceUp.current = true;
        setTimeout(() => (spaceUp.current = false), 0);
        end(true);
      }}
      onClick={(e) => {
        // Pointer presses are handled above. Enter and a screen reader's
        // activation arrive as a click with no pointer behind it: a tap.
        if (e.detail !== 0 || spaceUp.current) return;
        if (sendAt !== null) onCancelSend();
        else voice.tap();
      }}
    >
      {icon}
    </button>
  );
}

/** The line above the composer while voice input is busy or failed: timer,
 *  level and cancel; "Transcribing…"; or the error with Retry. Idle, it
 *  offers the language when there is a choice. */
export function VoiceStatus({ voice, sendAt, onCancelSend }: { voice: VoiceInput } & SendWindow) {
  const { status, startedAt, error, canRetry } = voice.state;
  const elapsed = useElapsed(status === "recording" ? startedAt : null);
  const sinceSendWindow = useElapsed(sendAt === null ? null : sendAt - SEND_DELAY_MS);
  const level = useLevel(status === "recording" ? voice.stream() : null);

  // Esc drops the recording. Captured on window so the chat's own Escape (which
  // stops a running turn) does not also fire.
  const busy = status === "starting" || status === "recording" || status === "transcribing";
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      voice.cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, voice]);

  if (sendAt !== null) {
    const left = Math.max(1, Math.ceil(SEND_DELAY_MS / 1000 - sinceSendWindow));
    return (
      <div className="voice-status" role="status">
        <span>Sending in {left} s — click the text to edit it</span>
        <span className="voice-spacer" />
        <button type="button" className="voice-x" onClick={onCancelSend} title="Keep as a draft (Esc)" aria-label="Keep as a draft">
          <X size={14} />
        </button>
      </div>
    );
  }
  if (status === "recording") {
    const left = voice.limitSeconds - elapsed;
    return (
      <div className="voice-status recording" role="status">
        <span className="voice-dot" />
        <span className="voice-time">{clock(elapsed)}</span>
        <span className="voice-level" aria-hidden>
          <span style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
        {left <= 15 && <span className="voice-left">stops in {Math.ceil(left)} s</span>}
        <span className="voice-spacer" />
        <button type="button" className="voice-x" onClick={voice.cancel} title="Discard (Esc)" aria-label="Discard recording">
          <X size={14} />
        </button>
      </div>
    );
  }
  if (status === "starting" || status === "transcribing") {
    return (
      <div className="voice-status" role="status">
        <Loader2 size={13} className="spin" />
        {status === "starting" ? "Waiting for the microphone…" : "Transcribing…"}
        <span className="voice-spacer" />
        <button type="button" className="voice-x" onClick={voice.cancel} title="Cancel (Esc)" aria-label="Cancel voice input">
          <X size={14} />
        </button>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="voice-status error" role="alert">
        <AlertCircle size={13} />
        <span>{error}</span>
        <span className="voice-spacer" />
        {canRetry && (
          <button type="button" className="voice-x" onClick={voice.retry} title="Send the recording again" aria-label="Retry">
            <RotateCcw size={14} />
          </button>
        )}
        <button type="button" className="voice-x" onClick={voice.dismiss} title="Dismiss" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
    );
  }
  return null;
}

/** The transcription language, when the server offers more than one: its
 *  speech-to-text default and the languages it speaks (useVoiceInput). */
export function VoiceLanguage({ voice }: { voice: VoiceInput }) {
  if (voice.languages.length < 2 || voice.state.status !== "idle" || voice.unavailable) return null;
  return (
    <select
      className="voice-lang"
      value={voice.language ?? ""}
      onChange={(e) => voice.pickLanguage(e.target.value)}
      title="Language you will speak"
      aria-label="Voice input language"
    >
      {voice.languages.map((l) => (
        <option key={l} value={l}>
          {l} · {languageName(l)}
        </option>
      ))}
    </select>
  );
}
