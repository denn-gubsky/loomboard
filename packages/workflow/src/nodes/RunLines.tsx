import type { RunLine } from "../types";

// The last few lines of the run going on an agent node — like a chat tile's
// preview: enough to see what it is doing, never the whole transcript. Model
// output, so rendered as text, never as markup.

export function RunLines({ lines, testId }: { lines: readonly RunLine[]; testId: string }) {
  if (!lines.length) return null;
  return (
    <ul className="lb-wf-node__lines" data-testid={testId}>
      {lines.map((l, i) => (
        <li key={i} className={`lb-wf-node__line lb-wf-node__line--${l.role} lb-wf-node__line--${l.kind}`} title={l.text}>
          {l.kind === "tool" ? `⚙ ${l.text}` : l.role === "user" ? `› ${l.text}` : l.text}
        </li>
      ))}
    </ul>
  );
}
