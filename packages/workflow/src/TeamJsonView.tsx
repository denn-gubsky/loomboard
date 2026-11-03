import { useState, type Ref } from "react";
import { CodeEditor, type CodeEditorHandle } from "@loomcycle/code-editor";

// The JSON view of the team (RFC DX): the definition as editable text.
//
// The editor is @loomcycle/code-editor's (RFC FW), which grew out of this
// view and keeps its contract: CodeMirror is loaded on first mount, a plain
// textarea edits the text until then (or if it cannot load), an external
// `text` replaces the content without echoing as an edit, and the cursor is
// reported only when the operator moves it. Its stylesheet is a second
// import for the host (see the README); the --lc-ce-* colours are pinned to
// the canvas theme in styles.css.

export interface JsonDiagnostic {
  /** Offsets into `text`. */
  from: number;
  to: number;
  severity: "error" | "info";
  message: string;
}

export type TeamJsonViewHandle = CodeEditorHandle;

export interface TeamJsonViewProps {
  text: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  diagnostics?: readonly JsonDiagnostic[];
  /** Offset of the `layout` key, folded when the editor opens (decision 3). */
  foldAt?: number;
  /** The operator moved the cursor (a click, an arrow key) — not a cursor
   *  this component's own `goto` / `reveal` placed, and not typing. */
  onCursor?: (offset: number) => void;
  handle?: Ref<TeamJsonViewHandle>;
}

const WRAP_KEY = "loomboard.workflow.json.wrap";

// Per browser, and only a convenience: storage can be missing or throw.
function readWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeWrap(on: boolean) {
  try {
    localStorage.setItem(WRAP_KEY, on ? "on" : "off");
  } catch {
    // Not remembered; the toggle still works for this view.
  }
}

export function TeamJsonView({ text, onChange, readOnly, diagnostics, foldAt, onCursor, handle }: TeamJsonViewProps) {
  // Wrapped by default: an own agent's system_prompt is one escaped line.
  const [wrap, setWrap] = useState(readWrap);
  return (
    <div className="lb-wf-json" data-testid="json-view">
      <div className="lb-wf-json__head">
        <label className="lb-wf-toggle" title="Wrap long lines, such as an agent's system prompt, to the width of the view.">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => {
              setWrap(e.target.checked);
              writeWrap(e.target.checked);
            }}
          />
          Wrap
        </label>
      </div>
      <div className="lb-wf-json__editor">
        <CodeEditor
          language="json"
          value={text}
          onChange={onChange}
          wrap={wrap}
          readOnly={readOnly}
          diagnostics={diagnostics}
          foldAt={foldAt}
          onCursor={onCursor}
          handle={handle}
          ariaLabel="Team definition (JSON)"
        />
      </div>
    </div>
  );
}
