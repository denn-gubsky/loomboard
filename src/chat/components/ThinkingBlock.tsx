import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import Markdown from "./Markdown";
import { formatDuration } from "../lib/metrics";

// Scaffolded reasoning trace, Open-WebUI style: auto-expands and shows a live
// "Thinking… Ns" while the model reasons, then auto-collapses to a static
// "Thought for N s" once it starts answering. Manual toggle wins until the next
// active-state change.
export default function ThinkingBlock({
  text,
  active,
  durationMs,
}: {
  text: string;
  active: boolean;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(active);
  const prevActive = useRef(active);
  useEffect(() => {
    if (prevActive.current !== active) {
      setOpen(active);
      prevActive.current = active;
    }
  }, [active]);

  // Live elapsed while thinking; the authoritative duration arrives as a prop
  // once the phase ends.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Date.now() - start), 200);
    return () => clearInterval(id);
  }, [active]);

  const label = active
    ? `Thinking… ${formatDuration(elapsed)}`
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Reasoning";

  return (
    <div className={open ? "thinking open" : "thinking"}>
      <button className="thinking-head" onClick={() => setOpen((o) => !o)} type="button">
        <ChevronRight size={14} className="caret" />
        <Brain size={14} />
        <span className={active ? "pulse" : ""}>{label}</span>
      </button>
      {open && (
        <div className="thinking-body">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
