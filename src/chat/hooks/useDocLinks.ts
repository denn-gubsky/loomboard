import { createContext, useContext } from "react";
import type { DocPreviewCache } from "../lib/docPreview";
import type { DocRefScope } from "../lib/docRefs";

/** Where a document link asks the host to go: the document, and for a chunk
 *  link the chunk inside it. */
export interface DocumentOpenTarget {
  documentId: string;
  chunkId?: string;
  scope: DocRefScope;
  /** The link's title, for the host to show until the document loads. */
  title?: string;
}

export interface DocLinks {
  previews: DocPreviewCache;
  /** Absent when the host cannot show a document: links then preview only. */
  open?: (target: DocumentOpenTarget) => void;
}

// Provided by <Chat>, read by every document link under it. Null outside a
// chat (a host rendering messages on its own), where links are titles only.
export const DocLinksContext = createContext<DocLinks | null>(null);

export function useDocLinks(): DocLinks | null {
  return useContext(DocLinksContext);
}
