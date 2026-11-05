import type { SpeechFormat } from "@loomcycle/client";
import type { MessagePart } from "./eventReducer";

/** The most characters one read-aloud request carries (RFC FX D4). The route
 *  answers only once it has synthesised and joined the whole input, so a long
 *  reply sent at once would be silent for a minute on a CPU speech host; small
 *  pieces, fetched one ahead of playback, start speaking in seconds. */
export const PIECE_CHARS = 800;

/** A reply's answer text: its text parts, without thinking, tool calls or
 *  notices. It is what Copy copies and what read-aloud speaks. Pure. */
export function answerText(parts: MessagePart[]): string {
  return parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n\n")
    .trim();
}

// Something to say. A block without a letter or digit (a rule, a lone emoji)
// would normalise to nothing, and the route refuses an input that is empty
// after normalising with a 400.
const HAS_WORD = /[\p{L}\p{N}]/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Markdown blocks: runs of lines between blank lines, with a fenced code
 *  block kept whole even when it holds blank lines. Pure. */
function markdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  let lines: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (lines.length > 0) blocks.push(lines.join("\n"));
    lines = [];
  };
  for (const line of text.split("\n")) {
    if (fence) {
      lines.push(line);
      const close = FENCE.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) {
        fence = null;
        flush();
      }
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      flush();
      fence = open[1];
      lines.push(line);
      continue;
    }
    if (line.trim() === "") flush();
    else lines.push(line);
  }
  flush();
  return blocks;
}

/** Cut one over-long block into parts of at most `max` characters: at the
 *  last sentence end or line break that leaves a part of a useful size, else
 *  at the last space, else (one huge word) at `max`. Pure. */
function cutLong(block: string, max: number): string[] {
  const parts: string[] = [];
  let rest = block;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = -1;
    for (const m of window.matchAll(/[.!?…]["'»”)\]]*\s|\n/g)) {
      const end = m.index + m[0].length;
      if (end <= max) cut = end;
    }
    if (cut < max / 3) cut = rest.slice(0, max).lastIndexOf(" ") + 1;
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

/** Split a reply into the pieces read-aloud requests one at a time: whole
 *  paragraphs packed up to `max` characters, a paragraph longer than that cut
 *  at a sentence end, and a fenced code block never cut (the runtime replaces
 *  it with a short spoken note). Blocks with nothing to say are dropped. Pure. */
export function splitForSpeech(text: string, max: number = PIECE_CHARS): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const block of markdownBlocks(text)) {
    if (!HAS_WORD.test(block)) continue;
    const parts = block.length > max && !FENCE.test(block) ? cutLong(block, max) : [block];
    for (const part of parts) {
      if (current && current.length + 2 + part.length > max) {
        pieces.push(current);
        current = "";
      }
      current = current ? `${current}\n\n${part}` : part;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** The language to name for one piece, or undefined to let loomcycle pick.
 *  loomcycle (1.140) detects only Cyrillic: Latin text goes to the
 *  deployment's default language, so with `uk` as the default the Ukrainian
 *  voice reads an English reply as near-silence. A piece whose Latin letters
 *  outnumber its Cyrillic ones is named `en` when the deployment speaks it.
 *  Remove once loomcycle picks the configured Latin-script language itself
 *  (G30 follow-up G31). Pure. */
export function speechLanguage(piece: string, languages: Record<string, unknown> | undefined): string | undefined {
  if (!languages || !("en" in languages)) return undefined;
  let latin = 0;
  let cyrillic = 0;
  for (const ch of piece) {
    if (/\p{Script=Latin}/u.test(ch) && /\p{L}/u.test(ch)) latin++;
    else if (/\p{Script=Cyrillic}/u.test(ch) && /\p{L}/u.test(ch)) cyrillic++;
  }
  return latin > cyrillic ? "en" : undefined;
}

/** The read-aloud format to ask for: the encoded format the deployment offers
 *  when this browser plays it, else WAV, which every deployment returns.
 *  `formats` is `wav` plus at most one of mp3 / ogg — whichever the operator's
 *  encoder makes — and asking for one it does not list is a 400. Ogg Opus only
 *  on a confident "probably": WebKit, which the desktop app runs on macOS,
 *  came to it late. Pure. */
export function pickSpeechFormat(
  formats: readonly string[] | undefined,
  canPlayType: (mime: string) => string,
): SpeechFormat {
  const offered = new Set(formats ?? []);
  if (offered.has("mp3") && canPlayType("audio/mpeg") !== "") return "mp3";
  if ((offered.has("ogg") || offered.has("opus")) && canPlayType('audio/ogg; codecs="opus"') === "probably") {
    return "ogg";
  }
  return "wav";
}
