import { Wrench, Brain } from "lucide-react";
import type { PreviewLine } from "../../lib/tilePreview";

// The tiny in-tile transcript: last few lines, small font, plain text. Tool /
// thinking lines render as muted chips (never full output/reasoning). No
// Markdown — deliberately cheap so tens of tiles stay light.
export default function AgentChatPreview({
  lines,
  placeholder,
}: {
  lines: PreviewLine[];
  placeholder?: string;
}) {
  if (lines.length === 0) {
    return <div className="acp acp-empty">{placeholder ?? "…"}</div>;
  }
  return (
    <div className="acp">
      {lines.map((l, i) => (
        <div key={i} className={`acp-line acp-${l.role} acp-${l.kind}`}>
          {l.kind === "tool" && <Wrench size={10} className="acp-glyph" />}
          {l.kind === "thinking" && <Brain size={10} className="acp-glyph" />}
          <span className="acp-text">{l.text}</span>
        </div>
      ))}
    </div>
  );
}
