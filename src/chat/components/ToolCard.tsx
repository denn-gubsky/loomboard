import { useState } from "react";
import {
  ChevronRight,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import type { ToolCall } from "../lib/eventReducer";

function formatInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

// Collapsible tool invocation: name + status badge in the header, input and
// result revealed on expand. Pending while the result hasn't arrived.
export default function ToolCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const pending = call.result === undefined;
  const input = formatInput(call.input);

  return (
    <div className={call.isError ? "tool err" : "tool"}>
      <button
        className="tool-head"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <ChevronRight size={14} className="caret" />
        <Wrench size={14} />
        <span className="tool-name">{call.name}</span>
        {pending ? (
          <Loader2 size={14} className="spin status" />
        ) : call.isError ? (
          <XCircle size={14} className="status x" />
        ) : (
          <CheckCircle2 size={14} className="status ok" />
        )}
      </button>
      {open && (
        <div className="tool-body">
          {input && (
            <>
              <div className="tool-label">input</div>
              <pre className="tool-pre">{input}</pre>
            </>
          )}
          {!pending && (
            <>
              <div className="tool-label">result</div>
              <pre className={call.isError ? "tool-pre error" : "tool-pre"}>
                {call.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
