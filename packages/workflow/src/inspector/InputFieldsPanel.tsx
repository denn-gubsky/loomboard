import { useState } from "react";
import { NAME_RE, type FieldType, type InputField, type PickerSpec } from "../lib/inputForm";

// The Input node's form, field by field (RFC CZ "The Input node"): what the
// person starting the team fills in, and which ${var.*} each field becomes.
//
// It edits the `input` state's `schema` and `capture` through
// lib/inputForm.ts fieldsPatch, so the raw schema stays the source of truth
// and anything this editor does not own (other keywords, an author's own
// capture) survives an edit.

const TYPES: FieldType[] = ["string", "number", "integer", "boolean"];

export interface InputFieldsPanelProps {
  fields: InputField[];
  disabled?: boolean;
  onChange: (fields: InputField[]) => void;
}

export function InputFieldsPanel({ fields, disabled, onChange }: InputFieldsPanelProps) {
  const [draftName, setDraftName] = useState("");
  const set = (i: number, f: Partial<InputField>) => onChange(fields.map((x, j) => (j === i ? { ...x, ...f } : x)));
  const documentFields = fields.filter((f) => f.picker?.kind === "document").map((f) => f.name);
  const nameOk = NAME_RE.test(draftName) && !fields.some((f) => f.name === draftName);

  const setPicker = (i: number, kind: string) => {
    if (!kind) return set(i, { picker: undefined });
    const picker: PickerSpec =
      kind === "chunk"
        ? { kind: "chunk", ...(documentFields[0] ? { document: documentFields[0] } : {}), depth: 1 }
        : { kind: "document", scope: "user" };
    set(i, { picker });
  };

  return (
    <section className="lb-wf-form-editor" aria-label="Form fields">
      <h3 className="lb-wf-team__title">Form fields</h3>
      <p className="lb-wf-team__hint">
        What the person starting the team fills in. A bound field becomes a variable every later prompt can use.
      </p>
      {fields.length === 0 && <p className="lb-wf-team__hint">No fields: Start asks for plain text.</p>}
      {fields.map((f, i) => (
        <fieldset key={f.name} className="lb-wf-form-editor__field" disabled={disabled}>
          <legend>
            <code>{f.name}</code>
          </legend>
          <label>
            Label
            <input value={f.title ?? ""} placeholder={f.name} onChange={(e) => set(i, { title: e.target.value || undefined })} />
          </label>
          <label>
            Type
            <select value={f.type} onChange={(e) => set(i, { type: e.target.value as FieldType })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="lb-wf-form-editor__check">
            <input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} />
            required
          </label>
          {f.type === "string" && (
            <label>
              Picker
              <select value={f.picker?.kind ?? ""} onChange={(e) => setPicker(i, e.target.value)}>
                <option value="">none — typed</option>
                <option value="document">a document</option>
                <option value="chunk">a chunk of a document</option>
              </select>
            </label>
          )}
          {f.picker?.kind === "document" && (
            <label>
              Under path
              <input
                value={f.picker.underPath ?? ""}
                placeholder="any"
                onChange={(e) => set(i, { picker: { ...f.picker!, underPath: e.target.value || undefined } })}
              />
            </label>
          )}
          {f.picker?.kind === "chunk" && (
            <>
              <label>
                Of the document in
                <select
                  value={f.picker.document ?? ""}
                  onChange={(e) => set(i, { picker: { ...f.picker!, document: e.target.value || undefined } })}
                >
                  <option value="">— choose a document field —</option>
                  {documentFields.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lb-wf-form-editor__check">
                <input
                  type="checkbox"
                  checked={f.picker.depth === 1}
                  onChange={(e) => set(i, { picker: { ...f.picker!, depth: e.target.checked ? 1 : undefined } })}
                />
                top-level sections only
              </label>
            </>
          )}
          <label className="lb-wf-form-editor__check">
            <input
              type="checkbox"
              checked={!!f.variable}
              onChange={(e) => set(i, { variable: e.target.checked ? f.name : undefined })}
            />
            bind as <code>{`\${var.${f.variable ?? f.name}}`}</code>
          </label>
          <button type="button" className="lb-wf-btn" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
            Remove field
          </button>
        </fieldset>
      ))}
      <div className="lb-wf-form-editor__add">
        <input
          aria-label="New field name"
          value={draftName}
          placeholder="new field, e.g. document_id"
          disabled={disabled}
          onChange={(e) => setDraftName(e.target.value.trim())}
        />
        <button
          type="button"
          className="lb-wf-btn"
          disabled={disabled || !nameOk}
          title={draftName && !nameOk ? "Letters, digits, - and _ only, and not a name already used" : undefined}
          onClick={() => {
            onChange([...fields, { name: draftName, type: "string", required: true, variable: draftName }]);
            setDraftName("");
          }}
        >
          Add field
        </button>
      </div>
    </section>
  );
}
