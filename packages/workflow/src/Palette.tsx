import { useState } from "react";
import { PALETTE_GROUPS, entriesInGroup, type PaletteEntry } from "./lib/palette";

// The node palette — RFC CZ C12.
//
// Grouped by what a node DOES rather than by what it compiles to, because the
// question an operator is answering is "where does work come from / who does it
// / what does it carry / where does it end", not "which handler kind".
//
// EXTERNAL entries (C11) are listed and not clickable. Hiding them would be
// worse: a Starter reads a channel something must publish to, and if the canvas
// never mentions schedules an operator has no way to learn that a cron feeding
// that channel is how the workflow starts. Shown-and-explained beats absent.

export interface PaletteProps {
  onPlace: (entry: PaletteEntry) => void;
  disabled?: boolean;
  /** Place a reference to an existing channel. Absent: the channel entry is
   *  shown and not offered, like an external one. */
  onPlaceChannel?: (name: string) => void;
  /** Declared channel names, offered as suggestions — free text is still
   *  allowed, because a team may be authored before its channels exist. */
  channelNames?: readonly string[];
}

export function Palette({ onPlace, disabled, onPlaceChannel, channelNames }: PaletteProps) {
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState("");
  const place = () => {
    if (!onPlaceChannel || !name.trim()) return;
    onPlaceChannel(name.trim());
    setName("");
    setPicking(false);
  };
  return (
    <aside className="lb-wf-palette" aria-label="Node palette">
      {PALETTE_GROUPS.map((group) => (
        <section key={group} className="lb-wf-palette__group">
          <h3 className="lb-wf-palette__title">{group}</h3>
          {entriesInGroup(group).map((entry) =>
            entry.reference ? (
              <div key={entry.id} className="lb-wf-palette__ref">
                <button
                  type="button"
                  className="lb-wf-palette__item"
                  title={entry.hint}
                  disabled={disabled || !onPlaceChannel}
                  onClick={() => setPicking((p) => !p)}
                  aria-expanded={picking}
                >
                  {entry.label}
                  <span className="lb-wf-palette__tag">referenced</span>
                </button>
                {picking && onPlaceChannel && (
                  <form
                    className="lb-wf-palette__pick"
                    onSubmit={(e) => {
                      e.preventDefault();
                      place();
                    }}
                  >
                    <input
                      className="lb-wf-input"
                      aria-label="Channel name"
                      list="lb-wf-channel-names"
                      placeholder="existing channel"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      spellCheck={false}
                      autoFocus
                    />
                    <datalist id="lb-wf-channel-names">
                      {(channelNames ?? []).map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <button type="submit" className="lb-wf-btn" disabled={!name.trim()}>
                      Place
                    </button>
                  </form>
                )}
              </div>
            ) : entry.external ? (
              <div
                key={entry.id}
                className="lb-wf-palette__item lb-wf-palette__item--external"
                title={entry.hint}
              >
                {entry.label}
                <span className="lb-wf-palette__tag">referenced</span>
              </div>
            ) : (
              <button
                key={entry.id}
                type="button"
                className="lb-wf-palette__item"
                title={entry.hint}
                disabled={disabled}
                onClick={() => onPlace(entry)}
              >
                {entry.label}
              </button>
            ),
          )}
        </section>
      ))}
    </aside>
  );
}
