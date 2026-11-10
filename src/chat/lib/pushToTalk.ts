import type { RecorderStatus } from "./voiceRecorder";

/** A press shorter than this is a tap: hands-free dictation into the draft.
 *  Longer, it is a hold: push-to-talk, sent after SEND_DELAY_MS (RFC FX D2). */
export const HOLD_MS = 300;

/** How long a held take's transcript waits in the input before it is sent.
 *  Long enough for one glance at a misheard name. */
export const SEND_DELAY_MS = 3000;

/** What ending a press does. `stop` transcribes and sends; `send` marks a
 *  take the limit already stopped mid-hold as one to send. */
export type ReleaseAction = "none" | "cancel" | "stop" | "send";

/** What a press ending `heldMs` after it began does, given where the recorder
 *  is then and whether the pointer was still over the mic. Pure. */
export function releaseAction(heldMs: number, status: RecorderStatus, inside: boolean): ReleaseAction {
  // Nothing in flight: the microphone was refused, or the take was cancelled.
  if (status === "idle" || status === "error") return "none";
  if (!inside) return "cancel";
  if (heldMs < HOLD_MS) return "none";
  // Held, but the mic never went live (the permission prompt took the press):
  // drop it rather than send a fragment.
  if (status === "starting") return "cancel";
  if (status === "recording") return "stop";
  return "send";
}

/** What a tap does: Enter, a screen reader's click, or a press while a
 *  hands-free recording runs. Pure. */
export function tapAction(status: RecorderStatus): "start" | "stop" | "cancel" {
  if (status === "recording") return "stop";
  if (status === "starting" || status === "transcribing") return "cancel";
  return "start";
}
