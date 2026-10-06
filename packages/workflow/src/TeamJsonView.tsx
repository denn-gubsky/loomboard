import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { EditorView } from "@codemirror/view";

// The JSON view of the team (RFC DX): the definition as editable text.
//
// CodeMirror 6 is imported only when this view first mounts, so a host that
// never opens it never loads the editor (decision 1). Until it has loaded —
// or if it cannot load — a plain textarea edits the same text, so the view is
// never blank and never read-only for want of the editor.
//
// The component is a controlled view over `text`: an edit calls `onChange`; a
// new `text` from outside (the canvas changed the team) replaces the editor's
// content without echoing back as an edit.

export interface JsonDiagnostic {
  /** Offsets into `text`. */
  from: number;
  to: number;
  severity: "error" | "info";
  message: string;
}

export interface TeamJsonViewHandle {
  /** Put the cursor at `offset` and scroll it into view. */
  goto(offset: number): void;
}

export interface TeamJsonViewProps {
  text: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  diagnostics?: readonly JsonDiagnostic[];
  /** Offset of the `layout` key, folded when the editor opens (decision 3). */
  foldAt?: number;
  handle?: Ref<TeamJsonViewHandle>;
}

type CM = {
  view: typeof import("@codemirror/view");
  state: typeof import("@codemirror/state");
  lint: typeof import("@codemirror/lint");
  language: typeof import("@codemirror/language");
};

export function TeamJsonView({ text, onChange, readOnly, diagnostics, foldAt, handle }: TeamJsonViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cm = useRef<CM | null>(null);
  const external = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const readOnlyCompartment = useRef<import("@codemirror/state").Compartment | null>(null);
  // The values as of mount, for the editor's first state; later changes go
  // through the effects below.
  const initial = useRef({ text, readOnly });
  // `layout` is folded once, when the editor first has the text to fold —
  // which can arrive after it loads.
  const folded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("codemirror"),
      import("@codemirror/lang-json"),
      import("@codemirror/lint"),
      import("@codemirror/state"),
      import("@codemirror/view"),
      import("@codemirror/language"),
    ])
      .then(([{ basicSetup }, { json }, lint, state, viewMod, language]) => {
        if (cancelled || !host.current) return;
        cm.current = { view: viewMod, state, lint, language };
        const ro = new state.Compartment();
        readOnlyCompartment.current = ro;
        const { text: doc, readOnly: r } = initial.current;
        const v = new viewMod.EditorView({
          parent: host.current,
          state: state.EditorState.create({
            doc,
            extensions: [
              basicSetup,
              json(),
              lint.lintGutter(),
              ro.of(readOnlyExtensions(state, viewMod, !!r)),
              viewMod.EditorView.updateListener.of((u) => {
                if (u.docChanged && !external.current) onChangeRef.current(u.state.doc.toString());
              }),
              viewMod.EditorView.theme({
                "&": { height: "100%", backgroundColor: "var(--lb-wf-bg)", color: "var(--lb-wf-fg)" },
                ".cm-gutters": { backgroundColor: "var(--lb-wf-surface)", color: "var(--lb-wf-muted)", border: "none" },
                ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" },
              }),
            ],
          }),
        });
        view.current = v;
        setLoaded(true);
      })
      .catch((e) => {
        console.warn("[canvas] the JSON editor could not load; editing as plain text:", e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
    };
  }, []);

  // A new text from outside replaces the content, without echoing as an edit.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === text) return;
    external.current = true;
    try {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
    } finally {
      external.current = false;
    }
  }, [text, loaded]);

  useEffect(() => {
    const v = view.current;
    if (!v || !cm.current || folded.current || foldAt === undefined || v.state.doc.toString() !== text) return;
    folded.current = true;
    foldLineAt(v, cm.current.language, foldAt);
  }, [foldAt, text, loaded]);

  useEffect(() => {
    const v = view.current;
    if (!v || !cm.current || !readOnlyCompartment.current) return;
    v.dispatch({ effects: readOnlyCompartment.current.reconfigure(readOnlyExtensions(cm.current.state, cm.current.view, !!readOnly)) });
  }, [readOnly, loaded]);

  useEffect(() => {
    const v = view.current;
    if (!v || !cm.current) return;
    const len = v.state.doc.length;
    const diags = (diagnostics ?? []).map((d) => ({
      from: Math.min(d.from, len),
      to: Math.min(Math.max(d.to, d.from), len),
      severity: d.severity === "error" ? ("error" as const) : ("info" as const),
      message: d.message,
    }));
    v.dispatch(cm.current.lint.setDiagnostics(v.state, diags));
  }, [diagnostics, loaded, text]);

  useImperativeHandle(
    handle,
    () => ({
      goto(offset: number) {
        const v = view.current;
        if (v) {
          const at = Math.min(offset, v.state.doc.length);
          v.dispatch({ selection: { anchor: at }, scrollIntoView: true });
          v.focus();
          return;
        }
        const ta = host.current?.querySelector("textarea");
        if (ta) {
          ta.focus();
          ta.setSelectionRange(offset, offset);
        }
      },
    }),
    [],
  );

  return (
    <div className="lb-wf-json" data-testid="json-view">
      <div ref={host} className="lb-wf-json__editor" data-loaded={loaded || undefined}>
        {!loaded && (
          <textarea
            className="lb-wf-json__plain"
            aria-label="Team definition (JSON)"
            spellCheck={false}
            value={text}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
      {failed && <div className="lb-wf-team__hint">The JSON editor could not load; this is plain text editing.</div>}
    </div>
  );
}

function readOnlyExtensions(state: CM["state"], viewMod: CM["view"], readOnly: boolean) {
  return [state.EditorState.readOnly.of(readOnly), viewMod.EditorView.editable.of(!readOnly)];
}

/** Fold the value on the line holding `offset` (the `layout` key), if it can. */
function foldLineAt(v: EditorView, language: CM["language"], offset: number) {
  const line = v.state.doc.lineAt(Math.min(offset, v.state.doc.length));
  // The syntax tree is built incrementally; make sure it covers the line.
  language.ensureSyntaxTree(v.state, line.to, 200);
  const range = language.foldable(v.state, line.from, line.to);
  if (range) v.dispatch({ effects: language.foldEffect.of(range) });
}
