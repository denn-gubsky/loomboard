import { DocumentViewer, type DocScope, type Principal } from "@loomcycle/explorer";
import { X } from "lucide-react";
import type { Connection, DocumentOpenTarget } from "../chat";

// A document an agent linked in the chat, shown beside the conversation so the
// chat stays where it is (and a running turn keeps streaming).
export default function DocSidePanel({
  connection,
  principal,
  target,
  width,
  onClose,
  onOpenInDocuments,
}: {
  connection: Connection;
  principal?: Principal;
  target: DocumentOpenTarget;
  width: number;
  onClose: () => void;
  onOpenInDocuments?: () => void;
}) {
  return (
    <aside className="doc-side-panel" style={{ width }} aria-label="Linked document">
      <header className="doc-side-panel__bar">
        <span className="doc-side-panel__title" title={target.title}>
          {target.title ?? "Document"}
        </span>
        {onOpenInDocuments && (
          <button type="button" onClick={onOpenInDocuments}>
            Open in Documents
          </button>
        )}
        <button type="button" className="doc-side-panel__close" aria-label="Close the document" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <DocumentViewer
        // A new document is a new viewer. Another section of the same one is
        // not: the viewer moves its selection to a changed chunkId in place.
        key={`${target.scope}:${target.documentId}`}
        connection={connection}
        documentId={target.documentId}
        chunkId={target.chunkId}
        scope={target.scope as DocScope}
        titleHint={target.title}
        principal={principal}
      />
    </aside>
  );
}
