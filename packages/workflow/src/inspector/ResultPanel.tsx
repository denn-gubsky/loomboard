import { useEffect, useState } from "react";
import { chunkIdOf, type ResultItem } from "../lib/output";
import type { ChunkContent, DocumentTarget, WorkflowDataLayer } from "../types";

// What a finished walk produced, in full, for the End node it reached.
//
// A team that writes to a Document answers with the id of the chunk it wrote
// (the pcparts article), which says nothing by itself. When the answer is a
// chunk id and the host can read chunks, this shows the chunk — title and
// body — and offers the host's Documents view for it. Anything else, or a
// chunk that cannot be read, is shown as the text it is.
//
// A chunk body is model output: rendered as text, never as markup.

export interface ResultPanelProps {
  items: readonly ResultItem[];
  readChunk?: WorkflowDataLayer["readChunk"];
  onOpenDocument?: (target: DocumentTarget) => void;
}

export function ResultPanel({ items, readChunk, onOpenDocument }: ResultPanelProps) {
  return (
    <section className="lb-wf-result" aria-label="Result">
      <h3 className="lb-wf-team__title">Result</h3>
      {items.map((r, i) => (
        <ResultEntry key={r.runId ?? i} item={r} readChunk={readChunk} onOpenDocument={onOpenDocument} />
      ))}
    </section>
  );
}

function ResultEntry({ item, readChunk, onOpenDocument }: { item: ResultItem } & Omit<ResultPanelProps, "items">) {
  const chunkId = chunkIdOf(item.text);
  const [chunk, setChunk] = useState<ChunkContent>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setChunk(undefined);
    setFailed(false);
    if (!chunkId || !readChunk) return;
    let cancelled = false;
    readChunk(chunkId)
      .then((c) => !cancelled && setChunk(c))
      // Not every 32-hex answer is a chunk the caller can read: fall back to
      // the text rather than report an error for a guess.
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [chunkId, readChunk]);

  const loading = !!chunkId && !!readChunk && !chunk && !failed;
  return (
    <article className="lb-wf-result__item">
      {item.agent && <div className="lb-wf-node__meta">{item.agent}</div>}
      {chunk ? (
        <>
          <div className="lb-wf-result__head">
            <strong title={chunk.id}>{chunk.title || "untitled chunk"}</strong>
            {onOpenDocument && (
              <button
                type="button"
                className="lb-wf-btn"
                onClick={() => onOpenDocument({ documentId: chunk.documentId, chunkId: chunk.id, scope: chunk.scope, title: chunk.title })}
              >
                Open in Documents
              </button>
            )}
          </div>
          <pre className="lb-wf-result__body">{chunk.body}</pre>
          <code className="lb-wf-result__id">chunk {chunk.id}</code>
        </>
      ) : (
        <pre className="lb-wf-result__body">{loading ? "Reading the chunk…" : item.text}</pre>
      )}
    </article>
  );
}
