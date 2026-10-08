import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { fromJsonDraft, viewDefinition } from "./lib/jsonDraft";
import type { CanvasModel } from "./lib/model";
import { formatDefinition, locateIn, parseDefinition, stateIndexAt, type ParseResult } from "./lib/teamJson";
import { findingPath, type Finding } from "./lib/validate";
import type { JsonDiagnostic } from "./TeamJsonView";

// Keeping the JSON view's text and the canvas's model one team (RFC DX).
//
//   canvas edit → the text is regenerated from the model (when the JSON view
//                 is on screen; on opening it otherwise);
//   text edit   → parsed at once (for its errors), and after a short pause,
//                 if it parses, the canvas is rebuilt from it.
//
// The text the operator typed is never regenerated under them: a model this
// hook produced from the text is recognised and left alone, so their
// formatting stays until the CANVAS changes the team.
//
// While the text does not parse, the model stays on its last valid draft and
// `error` says why: the canvas freezes and Save is disabled (decision 4).

const SETTLE_MS = 250;

export interface JsonDraft {
  text: string;
  onTextChange: (text: string) => void;
  /** The text's syntax error, while it has one. */
  error?: Extract<ParseResult, { ok: false }>;
  /** A text edit not yet applied to the canvas. */
  pending: boolean;
  /** Findings and the syntax error, placed in the text. */
  diagnostics: JsonDiagnostic[];
  /** Offset of each finding in the text, for jumping to it. */
  offsetOf: (f: Finding) => number | undefined;
  /** Offset of the `layout` key, to fold it. */
  layoutOffset?: number;
  /** The id of the state the text offset is in (RFC DX phase 6). */
  stateAt: (offset: number) => string | undefined;
  /** Where a state starts in the text. */
  offsetOfState: (id: string) => number | undefined;
}

export function useJsonDraft(
  model: CanvasModel | null,
  setModel: Dispatch<SetStateAction<CanvasModel | null>>,
  findings: readonly Finding[],
  active: boolean,
): JsonDraft {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParseResult>();
  const [pending, setPending] = useState(false);
  // The model the last text edit produced: one the text already describes.
  const fromText = useRef<CanvasModel | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!active || !model || model === fromText.current) return;
    const t = formatDefinition(viewDefinition(model));
    setText(t);
    setParsed(parseDefinition(t));
    fromText.current = model;
  }, [model, active]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onTextChange = useCallback(
    (t: string) => {
      setText(t);
      const r = parseDefinition(t);
      setParsed(r);
      clearTimeout(timer.current);
      if (!r.ok) {
        setPending(false);
        return;
      }
      setPending(true);
      timer.current = setTimeout(() => {
        const next = fromJsonDraft(r.def, modelRef.current);
        fromText.current = next;
        setModel(next);
        setPending(false);
      }, SETTLE_MS);
    },
    [setModel],
  );

  const error = parsed && !parsed.ok ? parsed : undefined;

  const offsetOf = useCallback(
    (f: Finding) => {
      if (!parsed?.ok || !model) return undefined;
      return locateIn(parsed.positions, findingPath(model, f))?.offset;
    },
    [parsed, model],
  );

  const diagnostics = useMemo<JsonDiagnostic[]>(() => {
    const lineEnd = (from: number) => {
      const nl = text.indexOf("\n", from);
      return nl < 0 ? text.length : nl;
    };
    if (error) {
      const from = error.position.offset;
      return [{ from, to: Math.max(from + 1, lineEnd(from)), severity: "error", message: error.message }];
    }
    const out: JsonDiagnostic[] = [];
    for (const f of findings) {
      const from = offsetOf(f);
      if (from === undefined) continue;
      out.push({ from, to: lineEnd(from), severity: f.level, message: f.message });
    }
    return out;
  }, [error, findings, offsetOf, text]);

  const layoutOffset = parsed?.ok ? parsed.positions.get("layout")?.offset : undefined;

  // Both read the TEXT's own states, not the model's: while an edit is still
  // settling, the text is ahead of the canvas.
  const textStates = useMemo(() => {
    const states = parsed?.ok ? parsed.def.states : undefined;
    return Array.isArray(states)
      ? states.map((st) => (typeof st === "object" && st !== null && !Array.isArray(st) && typeof st.state === "string" ? st.state : undefined))
      : [];
  }, [parsed]);

  const stateAt = useCallback(
    (offset: number) => {
      if (!parsed?.ok) return undefined;
      const i = stateIndexAt(parsed.positions, offset);
      return i === undefined ? undefined : textStates[i];
    },
    [parsed, textStates],
  );

  const offsetOfState = useCallback(
    (id: string) => {
      const i = textStates.indexOf(id);
      return i < 0 || !parsed?.ok ? undefined : parsed.positions.get(`states[${i}]`)?.offset;
    },
    [parsed, textStates],
  );

  return { text, onTextChange, error, pending, diagnostics, offsetOf, layoutOffset, stateAt, offsetOfState };
}
