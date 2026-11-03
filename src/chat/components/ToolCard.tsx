import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import type { ToolCall } from "../lib/eventReducer";
import { refsInToolResult } from "../lib/docRefs";
import DocRef from "./DocRef";

function formatInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

// A Document tool result with each document and chunk id it names given the
// same preview / open controls as an agent's link. The text itself is
// unchanged: the controls sit after the ids.
function ResultText({ call, result }: { call: ToolCall; result: string }) {
  const refs = useMemo(
    () => (call.isError ? [] : refsInToolResult(call.name, call.input, result)),
    [call.isError, call.name, call.input, result],
  );
  if (refs.length === 0) return <>{result}</>;
  const out: ReactNode[] = [];
  let at = 0;
  refs.forEach((r, i) => {
    out.push(result.slice(at, r.start));
    out.push(
      <DocRef key={i} target={r.ref}>
        {result.slice(r.start, r.end)}
      </DocRef>,
    );
    at = r.end;
  });
  out.push(result.slice(at));
  return <>{out}</>;
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
                <ResultText call={call} result={call.result ?? ""} />
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
