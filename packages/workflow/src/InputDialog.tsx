import { useEffect, useState, type ReactNode } from "react";
import { chunkOptions, formInput, type ChunkOption, type FormResult, type InputField } from "./lib/inputForm";
import type { DocumentOption, WorkflowDataLayer } from "./types";
import { varValueError } from "./lib/teamLocal";

// The Start dialog of the Input node (RFC CZ "The Input node"): the team's
// form, filled in by the person starting it, then sent.
//
// A field with an `x-loomcycle-picker` is chosen, not typed: a document
// picker lists documents, a chunk picker lists the chunks of the document
// chosen in its sibling field. The value is still the plain id, which is all
// a headless caller would send. Without the host's listing (or when it
// fails) the field falls back to typing, so a picker never blocks a start.

export interface InputDialogProps {
  fields: InputField[];
  /** The team's declared variables, name → default (RFC DV). Each is offered
   *  prefilled; only the changed ones are sent. */
  vars?: Record<string, string>;
  listDocuments?: WorkflowDataLayer["listDocuments"];
  listChunks?: WorkflowDataLayer["listChunks"];
  busy?: boolean;
  /** Why Start cannot be pressed (unsaved changes, a live walk…). */
  blocked?: string;
  error?: string;
  onStart: (form: FormResult, vars?: Record<string, string>) => void;
  onClose: () => void;
}

type Values = Record<string, string | boolean | undefined>;

export function InputDialog({ fields, vars, listDocuments, listChunks, busy, blocked, error, onStart, onClose }: InputDialogProps) {
  const [values, setValues] = useState<Values>({});
  const [varValues, setVarValues] = useState<Record<string, string>>(() => ({ ...(vars ?? {}) }));
  const varNames = Object.keys(vars ?? {}).sort();
  const varErrors = Object.fromEntries(varNames.flatMap((n) => {
    const why = varValueError(varValues[n] ?? "");
    return why ? [[n, why]] : [];
  }));
  const [plain, setPlain] = useState("");
  const [shown, setShown] = useState<Record<string, string>>({});
  // Choosing another document clears the chunks picked from the last one: a
  // chunk id from document A sent with document B would be a silent mismatch.
  const set = (name: string, v: string | boolean) =>
    setValues((cur) => {
      const next: Values = { ...cur, [name]: v };
      for (const f of fields) if (f.picker?.kind === "chunk" && f.picker.document === name) next[f.name] = undefined;
      return next;
    });

  const submit = () => {
    const form = formInput(fields, values, plain);
    setShown(form.errors);
    if (Object.keys(form.errors).length || Object.keys(varErrors).length) return;
    // Only what differs from the default: the walk records exactly what the
    // person chose (spec.team.vars), and an untouched default stays the
    // definition's.
    const changed = Object.fromEntries(varNames.filter((n) => varValues[n] !== vars![n]).map((n) => [n, varValues[n]]));
    onStart(form, Object.keys(changed).length ? changed : undefined);
  };

  return (
    <section className="lb-wf-start" role="dialog" aria-label="Start the team">
      <header className="lb-wf-start__head">
        <strong>Start</strong>
        <span className="lb-wf-team__hint">
          {" "}— runs the saved version with this input
        </span>
        <span className="lb-wf-toolbar__spacer" />
        <button type="button" className="lb-wf-btn" onClick={onClose}>
          Close
        </button>
      </header>

      {fields.length === 0 ? (
        <label className="lb-wf-start__field">
          Input
          <textarea value={plain} rows={3} onChange={(e) => setPlain(e.target.value)} />
        </label>
      ) : (
        fields.map((f) => (
          <div key={f.name} className="lb-wf-start__field">
            <label htmlFor={`lb-wf-in-${f.name}`}>
              {f.title ?? f.name}
              {f.required && <span aria-hidden> *</span>}
              {f.variable && <code className="lb-wf-start__var">{`\${var.${f.variable}}`}</code>}
            </label>
            <FieldInput
              field={f}
              id={`lb-wf-in-${f.name}`}
              value={values[f.name]}
              documentId={f.picker?.document ? (values[f.picker.document] as string | undefined) : undefined}
              listDocuments={listDocuments}
              listChunks={listChunks}
              onChange={(v) => set(f.name, v)}
            />
            {shown[f.name] && <div className="lb-wf-finding lb-wf-finding--error">{shown[f.name]}</div>}
          </div>
        ))
      )}

      {varNames.length > 0 && (
        <fieldset className="lb-wf-start__vars">
          <legend>Variables</legend>
          {varNames.map((n) => (
            <div key={n} className="lb-wf-start__field">
              <label htmlFor={`lb-wf-var-${n}`}>
                <code>{`\${var.${n}}`}</code>
                {varValues[n] !== vars![n] && <span className="lb-wf-team__hint"> · changed</span>}
              </label>
              <input
                id={`lb-wf-var-${n}`}
                value={varValues[n] ?? ""}
                placeholder="(empty)"
                onChange={(e) => setVarValues((cur) => ({ ...cur, [n]: e.target.value }))}
              />
              {varErrors[n] && <div className="lb-wf-finding lb-wf-finding--error">{varErrors[n]}</div>}
            </div>
          ))}
        </fieldset>
      )}

      {error && <div className="lb-wf-finding lb-wf-finding--error">{error}</div>}
      {blocked && <div className="lb-wf-finding lb-wf-finding--info">{blocked}</div>}
      <button type="button" className="lb-wf-btn lb-wf-btn--primary" onClick={submit} disabled={busy || !!blocked}>
        {busy ? "Starting…" : "Start"}
      </button>
    </section>
  );
}

function FieldInput({
  field,
  id,
  value,
  documentId,
  listDocuments,
  listChunks,
  onChange,
}: {
  field: InputField;
  id: string;
  value: string | boolean | undefined;
  documentId?: string;
  listDocuments?: WorkflowDataLayer["listDocuments"];
  listChunks?: WorkflowDataLayer["listChunks"];
  onChange: (v: string | boolean) => void;
}) {
  if (field.type === "boolean") {
    return <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  const typed = (
    <input
      id={id}
      type={field.type === "string" ? "text" : "number"}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  if (field.picker?.kind === "document" && listDocuments) {
    return <DocumentPicker id={id} field={field} value={value as string | undefined} list={listDocuments} onChange={onChange} fallback={typed} />;
  }
  if (field.picker?.kind === "chunk" && listChunks) {
    return (
      <ChunkPicker id={id} field={field} value={value as string | undefined} documentId={documentId} list={listChunks} onChange={onChange} fallback={typed} />
    );
  }
  return typed;
}

function DocumentPicker({
  id,
  field,
  value,
  list,
  onChange,
  fallback,
}: {
  id: string;
  field: InputField;
  value?: string;
  list: NonNullable<WorkflowDataLayer["listDocuments"]>;
  onChange: (v: string) => void;
  fallback: ReactNode;
}) {
  const [docs, setDocs] = useState<DocumentOption[]>();
  const [failed, setFailed] = useState(false);
  const scope = field.picker?.scope ?? "user";
  const underPath = field.picker?.underPath;
  useEffect(() => {
    let cancelled = false;
    list({ scope, underPath })
      .then((d) => !cancelled && setDocs(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [list, scope, underPath]);
  if (failed) return <>{fallback}</>;
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={!docs}>
      <option value="">{docs ? "— choose a document —" : "Loading…"}</option>
      {docs?.map((d) => (
        <option key={d.id} value={d.id}>
          {d.title}
        </option>
      ))}
    </select>
  );
}

function ChunkPicker({
  id,
  field,
  value,
  documentId,
  list,
  onChange,
  fallback,
}: {
  id: string;
  field: InputField;
  value?: string;
  documentId?: string;
  list: NonNullable<WorkflowDataLayer["listChunks"]>;
  onChange: (v: string) => void;
  fallback: ReactNode;
}) {
  const [chunks, setChunks] = useState<ChunkOption[]>();
  const [failed, setFailed] = useState(false);
  const scope = field.picker?.scope ?? "user";
  const depth = field.picker?.depth;
  // A chunk picker that names no document field has nothing to list.
  const follows = !!field.picker?.document;
  useEffect(() => {
    setChunks(undefined);
    if (!documentId) return;
    let cancelled = false;
    list(documentId, { scope })
      .then((rows) => !cancelled && setChunks(chunkOptions(rows, depth)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [list, documentId, scope, depth]);
  if (failed || !follows) return <>{fallback}</>;
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={!chunks}>
      <option value="">{!documentId ? "— choose the document first —" : chunks ? "— choose a chunk —" : "Loading…"}</option>
      {chunks?.map((c) => (
        <option key={c.id} value={c.id}>
          {"  ".repeat(c.depth - 1)}
          {c.title}
        </option>
      ))}
    </select>
  );
}
