import type { SpeechDirectionInfo, TranscriptionDirectionInfo } from "@loomcycle/client";
import { WAV_BYTES_PER_SECOND } from "./wav";

/** The longest recording loomboard takes before stopping by itself. */
export const CLIENT_MAX_SECONDS = 5 * 60;

/** How long a recording may run: the client's own limit, the server's per
 *  request limit, and what its upload limit holds as voice input's WAV
 *  (16 MiB by default is about 8.7 minutes). Pure. */
export function recordingLimitSeconds(info: TranscriptionDirectionInfo): number {
  let limit = CLIENT_MAX_SECONDS;
  if (info.max_seconds_per_request) limit = Math.min(limit, info.max_seconds_per_request);
  if (info.max_upload_bytes) limit = Math.min(limit, Math.floor((info.max_upload_bytes - 44) / WAV_BYTES_PER_SECOND));
  return Math.max(1, limit);
}

/** Whether `accepts` takes a recording of `type`. Entries may be patterns
 *  (`audio/*` when the server converts); parameters such as `;codecs=opus`
 *  are ignored. Pure. */
export function typeAccepted(accepts: readonly string[] | undefined, type: string): boolean {
  const mime = type.split(";")[0].trim().toLowerCase();
  if (!mime) return false;
  return (accepts ?? []).some((a) => {
    const entry = a.trim().toLowerCase();
    return entry.endsWith("/*") ? mime.startsWith(entry.slice(0, -1)) : entry === mime;
  });
}

/** Whether the browser's own recording may be sent as it is, when it could
 *  not be turned into WAV: the server takes its type, and it fits both the
 *  upload limit and (without a converter) what the engine reads whole. Pure. */
export function canSendRecording(info: TranscriptionDirectionInfo, recording: { type: string; size: number }): boolean {
  if (!typeAccepted(info.accepts, recording.type)) return false;
  if (info.max_upload_bytes && recording.size > info.max_upload_bytes) return false;
  if (info.whole_file_max_bytes && recording.size > info.whole_file_max_bytes) return false;
  return true;
}

/** The languages the mic offers. The operator's list when the server
 *  publishes one (`transcription.stt.languages`, loomcycle 1.143+), in its
 *  order: a request in any other language is refused. Without one, the
 *  server's speech-to-text default, then the languages it speaks, then the
 *  host's. Pure. */
export function voiceLanguages(
  transcription: TranscriptionDirectionInfo,
  speech: SpeechDirectionInfo | null,
  host?: string,
): string[] {
  if (transcription.languages && transcription.languages.length > 0) return [...new Set(transcription.languages)];
  const all = [transcription.default_language, ...Object.keys(speech?.languages ?? {}), host];
  return [...new Set(all.filter((l): l is string => !!l))];
}

/** A language's name in itself ("Українська" for uk), for the picker; the
 *  code where the runtime has no name for it. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // an engine without Intl.DisplayNames, or a code it does not take
  }
  return code;
}

/** The language to transcribe in (RFC FX D5): the one picked for this
 *  conversation, else the host's, else the server's default, else the first
 *  browser language the mic offers; undefined leaves it to the server. Sent
 *  explicitly because whisper's own guess flips Ukrainian to Russian on short
 *  clips. Pure. */
export function voiceLanguage(
  options: readonly string[],
  picked: string | undefined,
  host: string | undefined,
  serverDefault: string | undefined,
  browser: readonly string[],
): string | undefined {
  for (const l of [picked, host, serverDefault]) if (l && options.includes(l)) return l;
  for (const b of browser) {
    const code = b.split("-")[0].toLowerCase();
    if (options.includes(code)) return code;
  }
  return undefined;
}

/** Put a transcript into the draft at the selection, with a space on either
 *  side where it would run into a word. Returns the new text and where the
 *  caret goes. Pure. */
export function insertTranscript(
  text: string,
  start: number,
  end: number,
  transcript: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const insert = lead + transcript + trail;
  return { text: before + insert + after, caret: before.length + lead.length + transcript.length };
}
