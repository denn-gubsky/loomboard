import { useState } from "react";
import { importDefinition, importNotes, teamNameError } from "./lib/newTeam";
import type { JsonObject } from "./lib/model";

// The two dialogs of building a team by hand (RFC DX phase 4): naming a new
// team, and bringing a definition in from text or a file.
//
// Panels above the graph, like the Start dialog. Neither talks to the
// runtime: the canvas does, and hands back what the runtime said.

export interface SaveAsDialogProps {
  /** The team this one is made from, when there is one. */
  from?: string | null;
  busy?: boolean;
  /** Why the runtime, or the name check against it, refused. */
  error?: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

export function SaveAsDialog({ from, busy, error, onSave, onClose }: SaveAsDialogProps) {
  const [name, setName] = useState("");
  // The grammar only: whether the name is taken is the runtime's to say, and
  // is checked when the team is created.
  const why = name ? teamNameError(name, []) : undefined;
  return (
    <form
      className="lb-wf-start"
      role="dialog"
      aria-label="Save as a new team"
      onSubmit={(e) => {
        e.preventDefault();
        if (name && !why && !busy) onSave(name);
      }}
    >
      <header className="lb-wf-start__head">
        <strong>New team</strong>
        <span className="lb-wf-team__hint">
          {" "}— {from ? `a copy of ${from} as it is shown, under a new name` : "saved as its first version"}
        </span>
        <span className="lb-wf-toolbar__spacer" />
        <button type="button" className="lb-wf-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="lb-wf-start__field">
        <label htmlFor="lb-wf-team-name">Team name</label>
        <input
          id="lb-wf-team-name"
          value={name}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        {why && <div className="lb-wf-finding lb-wf-finding--error">{why}</div>}
      </div>
      {error && <div className="lb-wf-finding lb-wf-finding--error">{error}</div>}
      <div>
        <button type="submit" className="lb-wf-btn lb-wf-btn--primary" disabled={!name || !!why || busy}>
          {busy ? "Creating…" : "Create team"}
        </button>
      </div>
    </form>
  );
}

export interface ImportDialogProps {
  onImport: (def: JsonObject) => void;
  onClose: () => void;
}

export function ImportDialog({ onImport, onClose }: ImportDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  // An import is someone else's text, and a save stores all of it under the
  // operator's authority — including what the graph does not draw. Such a
  // definition is listed first and replaces the draft on a second press.
  const [review, setReview] = useState<{ def: JsonObject; notes: string[] }>();

  const edit = (t: string) => {
    setText(t);
    setError(undefined);
    setReview(undefined);
  };

  const submit = () => {
    if (review) return onImport(review.def);
    const r = importDefinition(text);
    if (!r.ok) {
      setError(r.position ? `Line ${r.position.line}, column ${r.position.column}: ${r.message}` : r.message);
      return;
    }
    const notes = importNotes(r.def);
    if (notes.length) setReview({ def: r.def, notes });
    else onImport(r.def);
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then(
      edit,
      (e) => setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`),
    );
  };

  return (
    <section className="lb-wf-start" role="dialog" aria-label="Import a team definition">
      <header className="lb-wf-start__head">
        <strong>Import</strong>
        <span className="lb-wf-team__hint"> — replaces what is shown; nothing is saved until you save</span>
        <span className="lb-wf-toolbar__spacer" />
        <button type="button" className="lb-wf-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="lb-wf-start__field">
        <label htmlFor="lb-wf-import-file">From a .json file</label>
        <input
          id="lb-wf-import-file"
          type="file"
          accept=".json,application/json"
          onChange={(e) => readFile(e.target.files?.[0])}
        />
      </div>
      <div className="lb-wf-start__field">
        <label htmlFor="lb-wf-import-text">Or paste the definition</label>
        <textarea
          id="lb-wf-import-text"
          rows={8}
          spellCheck={false}
          value={text}
          onChange={(e) => edit(e.target.value)}
        />
      </div>
      {error && <div className="lb-wf-finding lb-wf-finding--error">{error}</div>}
      {review && (
        <div className="lb-wf-finding lb-wf-finding--info" role="alert">
          This definition carries more than the graph shows. Saving it stores all of this as yours — read it in the
          JSON view before you save:
          <ul>
            {review.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <button type="button" className="lb-wf-btn lb-wf-btn--primary" onClick={submit} disabled={!text.trim()}>
          {review ? "Replace the draft anyway" : "Replace the draft"}
        </button>
      </div>
    </section>
  );
}
