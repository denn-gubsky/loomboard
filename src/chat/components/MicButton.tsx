import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Mic, RotateCcw, Square, X } from "lucide-react";
import type { VoiceInput } from "../hooks/useVoiceInput";

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

/** The composer's microphone button (RFC FX P2). */
export function MicButton({ voice, disabled }: { voice: VoiceInput; disabled: boolean }) {
  const { status } = voice.state;
  if (voice.unavailable) {
    return (
      <button type="button" className="mic-btn" disabled title={voice.unavailable} aria-label={voice.unavailable}>
        <Mic size={18} />
      </button>
    );
  }
  if (status === "recording") {
    return (
      <button type="button" className="mic-btn recording" onClick={voice.stop} title="Stop and transcribe" aria-label="Stop and transcribe">
        <Square size={14} />
      </button>
    );
  }
  if (status === "starting" || status === "transcribing") {
    return (
      <button type="button" className="mic-btn" onClick={voice.cancel} title="Cancel" aria-label="Cancel voice input">
        <Loader2 size={18} className="spin" />
      </button>
    );
  }
  const lang = voice.language ? ` (${voice.language})` : "";
  return (
    <button
      type="button"
      className="mic-btn"
      onClick={voice.start}
      disabled={disabled}
      title={`Voice input${lang}`}
      aria-label="Voice input"
    >
      <Mic size={18} />
    </button>
  );
}

/** The line above the composer while voice input is busy or failed: timer,
 *  level and cancel; "Transcribing…"; or the error with Retry. Idle, it
 *  offers the language when there is a choice. */
export function VoiceStatus({ voice }: { voice: VoiceInput }) {
  const { status, startedAt, error, canRetry } = voice.state;
  const elapsed = useElapsed(status === "recording" ? startedAt : null);
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

/** The transcription language, when there is more than one to choose. */
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
          {l}
        </option>
      ))}
    </select>
  );
}
