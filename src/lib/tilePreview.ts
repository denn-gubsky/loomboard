import type { ChatMessage, MessagePart } from "../chat";

// Turn the message view model into a few compact lines for a tiny tile preview —
// "just enough to show something is happening here." Deliberately lossy: no
// Markdown/katex/mermaid (that stack is what makes tens of tiles heavy), tool /
// thinking parts collapse to a one-line chip. Pure → unit-tested.

export interface PreviewLine {
  role: "user" | "assistant";
  kind: "text" | "tool" | "thinking" | "notice";
  text: string;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function partToLine(p: MessagePart, maxChars: number): Omit<PreviewLine, "role"> | null {
  switch (p.type) {
    case "text": {
      const t = collapse(p.text);
      return t ? { kind: "text", text: truncate(t, maxChars) } : null;
    }
    case "thinking":
      return { kind: "thinking", text: "thinking…" };
    case "tool":
      return { kind: "tool", text: p.call.name };
    case "notice":
      return { kind: "notice", text: truncate(collapse(p.text), maxChars) };
  }
}

/** The last `maxLines` meaningful lines across the transcript (oldest→newest),
 *  each truncated to `maxChars`. User turns are one line; each assistant part is
 *  its own line so an in-progress "…thinking → tool → text" reads in order. */
export function previewFromMessages(
  messages: ChatMessage[],
  maxLines = 3,
  maxChars = 140,
): PreviewLine[] {
  const all: PreviewLine[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const t = collapse(m.text);
      if (t) all.push({ role: "user", kind: "text", text: truncate(t, maxChars) });
    } else {
      for (const p of m.parts) {
        const line = partToLine(p, maxChars);
        if (line) all.push({ role: "assistant", ...line });
      }
    }
  }
  return all.slice(-maxLines);
}
