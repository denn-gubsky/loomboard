import { useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import type { HistoryChat } from "../lib/historyTypes";

// The sidebar search bar. Typing filters the loaded chat list by title instantly
// (client-side — covers drafts and needs no round-trip). The ✨ button runs a
// SEMANTIC search on the server (`history related`); when no embedder is
// configured that refuses cleanly, so we fall back to the title filter and say so.

export interface ChatFilter {
  /** Lowercased title substring; "" = no title filter. */
  text: string;
  /** Ordered sessionIds from a semantic search, or null when not active. */
  semanticIds: string[] | null;
}

export const NO_FILTER: ChatFilter = { text: "", semanticIds: null };

export default function HistorySearch({
  related,
  onChange,
}: {
  related: (q: string) => Promise<HistoryChat[] | null>;
  onChange: (f: ChatFilter) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function setText(v: string) {
    setQ(v);
    setNote(null);
    // Typing always returns to instant title filtering (drops any semantic set).
    onChange({ text: v.trim().toLowerCase(), semanticIds: null });
  }

  function clear() {
    setQ("");
    setNote(null);
    onChange(NO_FILTER);
  }

  async function runSemantic() {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await related(query);
      if (res === null) {
        setNote("Semantic search isn't enabled — showing title matches.");
        onChange({ text: query.toLowerCase(), semanticIds: null });
      } else {
        setNote(res.length ? `${res.length} similar` : "No similar chats found.");
        onChange({ text: "", semanticIds: res.map((c) => c.session_id) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="history-search">
      <div className="history-search-row">
        <Search size={13} className="history-search-icon" aria-hidden />
        <input
          type="search"
          value={q}
          placeholder="Search chats…"
          aria-label="Search chats"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSemantic();
            }
            if (e.key === "Escape") clear();
          }}
        />
        <button
          type="button"
          className="history-search-btn"
          title="Semantic search"
          aria-label="Semantic search"
          disabled={busy || !q.trim()}
          onClick={() => void runSemantic()}
        >
          <Sparkles size={13} />
        </button>
        {q && (
          <button
            type="button"
            className="history-search-btn"
            title="Clear search"
            aria-label="Clear search"
            onClick={clear}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {note && <p className="history-search-note">{note}</p>}
    </div>
  );
}
