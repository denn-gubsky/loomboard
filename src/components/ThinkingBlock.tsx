import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import Markdown from "./Markdown";

// Scaffolded, collapsible reasoning trace. Collapsed by default so the answer
// leads; expand to read the model's thinking. A pulsing label marks live
// reasoning still streaming in.
export default function ThinkingBlock({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? "thinking open" : "thinking"}>
      <button
        className="thinking-head"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <ChevronRight size={14} className="caret" />
        <Brain size={14} />
        <span className={streaming ? "pulse" : ""}>
          Reasoning{streaming ? "…" : ""}
        </span>
      </button>
      {open && (
        <div className="thinking-body">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
