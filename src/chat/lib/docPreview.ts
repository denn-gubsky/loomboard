import type { DocRef, DocRefScope } from "./docRefs";
import { describeError } from "./errors";

// What the preview popover shows for a document link, and how it is fetched.
// Kept off React so the mapping and the cache are testable with a fake call.

/** The one client method the previews need. Narrower than `client.document`, so
 *  tests pass a plain function and the package does not depend on how the SDK
 *  types the rest of the Document tool. */
export type DocumentCall = (input: {
  op: "get_document" | "get_chunk";
  id: string;
  scope: DocRefScope;
  /** Ask for the annotation alongside (only sent in the tenant scope). */
  with_summary?: boolean;
}) => Promise<unknown>;

export interface DocPreview {
  /** The document the link lands in — for a chunk, the one that holds it. */
  documentId: string;
  /** Set for a chunk link. */
  chunkId?: string;
  title: string;
  /** For a chunk: the title of its document. */
  documentTitle?: string;
  type?: string;
  tags: string[];
  /** The start of the body, cut on a word. */
  excerpt: string;
  truncated: boolean;
  /** The annotation's one-sentence brief: the popover's lead line. Set only
   *  when an annotation of this target has been written. */
  brief?: string;
  /** The annotation's abstract, shown in place of the excerpt. */
  abstract?: string;
  /** The annotation was written before the text last changed. */
  stale?: boolean;
  /** For a chunk: the brief of the document that holds it. */
  documentBrief?: string;
  documentBriefStale?: boolean;
}

export type DocPreviewResult =
  | { ok: true; preview: DocPreview }
  | { ok: false; notFound: boolean; reason: string };

export const EXCERPT_CHARS = 600;

/** The body's first `max` characters, cut back to the last whole word. */
export function excerpt(body: string, max = EXCERPT_CHARS): { text: string; truncated: boolean } {
  const t = body.trim();
  if (t.length <= max) return { text: t, truncated: false };
  const cut = t.slice(0, max);
  const space = cut.search(/\s\S*$/);
  return { text: (space > max / 2 ? cut.slice(0, space) : cut).trimEnd(), truncated: true };
}

type Row = Record<string, unknown>;

function row(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
function tags(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

// Annotations exist only in the tenant scope, so only there is the option sent;
// every other read stays exactly as it was.
function summaryOption(scope: DocRefScope): { with_summary?: true } {
  return scope === "tenant" ? { with_summary: true } : {};
}

/** The parts of an annotation summary the popover shows. A summary without a
 *  brief is no summary: nothing is ever made up from the body. */
interface Summary {
  brief: string;
  abstract?: string;
  stale: boolean;
  /** Set when the record belongs to an ancestor, not the row itself. */
  chunkId?: string;
}

function summary(v: unknown): Summary | undefined {
  const s = row(v);
  const brief = str(s.brief);
  if (!brief) return undefined;
  return { brief, abstract: str(s.abstract), stale: s.stale === true, chunkId: str(s.chunk_id) };
}

/** The preview fields of the target's own annotation. */
function own(s: Summary | undefined): Pick<DocPreview, "brief" | "abstract" | "stale"> {
  if (!s) return {};
  return { brief: s.brief, ...(s.abstract ? { abstract: s.abstract } : {}), ...(s.stale ? { stale: true } : {}) };
}

function unavailable(e: unknown): DocPreviewResult {
  const reason = describeError(e);
  // loomcycle answers a missing id as a refused tool call (422) whose text is
  // "get_chunk: no such chunk: <id>" / "… no such document …".
  return { ok: false, notFound: /no such (chunk|document)/i.test(reason), reason };
}

/** Fetch what the popover shows. Two reads: the target, then its other half —
 *  a document's root chunk for the excerpt, a chunk's document for its title.
 *  The second read failing still answers with what the first one gave.
 *
 *  In the tenant scope the reads also ask for the annotation: its brief leads
 *  the popover and its abstract stands in for the excerpt, which stays the
 *  fallback when no annotation has been written (a document with an abstract
 *  needs no second read). */
export async function loadDocPreview(call: DocumentCall, ref: DocRef): Promise<DocPreviewResult> {
  const { id, scope } = ref;
  const opt = summaryOption(scope);
  try {
    if (ref.kind === "doc") {
      const doc = row(await call({ op: "get_document", id, scope, ...opt }));
      const ann = summary(doc.summary);
      const root = str(doc.root_chunk_id);
      const body =
        root && !ann?.abstract
          ? str(row(await call({ op: "get_chunk", id: root, scope }).catch(() => null)).body)
          : undefined;
      const ex = excerpt(body ?? "");
      return {
        ok: true,
        preview: {
          documentId: str(doc.document_id) ?? id,
          title: str(doc.title) ?? "Untitled document",
          type: str(doc.type),
          tags: tags(doc.tags),
          excerpt: ex.text,
          truncated: ex.truncated,
          ...own(ann),
        },
      };
    }
    const chunk = row(await call({ op: "get_chunk", id, scope, ...opt }));
    const documentId = str(chunk.document_id);
    if (!documentId) return { ok: false, notFound: true, reason: "The chunk has no document." };
    const doc = row(await call({ op: "get_document", id: documentId, scope }).catch(() => null));
    const ex = excerpt(str(chunk.body) ?? "");
    // The chunk's own annotation only: a summary inherited from an ancestor
    // describes a wider part, so the chunk then shows its excerpt — and the
    // document's brief below it either way.
    const ann = summary(chunk.summary);
    const docAnn = summary(chunk.document_summary);
    return {
      ok: true,
      preview: {
        documentId,
        chunkId: id,
        title: str(chunk.title) ?? "Untitled section",
        // A document's root chunk is the document: "in <itself>" says nothing.
        documentTitle: str(doc.root_chunk_id) === id ? undefined : str(doc.title),
        type: str(chunk.type),
        tags: tags(chunk.tags),
        excerpt: ex.text,
        truncated: ex.truncated,
        ...own(ann && (!ann.chunkId || ann.chunkId === id) ? ann : undefined),
        ...(docAnn ? { documentBrief: docAnn.brief, ...(docAnn.stale ? { documentBriefStale: true } : {}) } : {}),
      },
    };
  } catch (e) {
    return unavailable(e);
  }
}

export interface DocPreviewCache {
  load(ref: DocRef): Promise<DocPreviewResult>;
  /** The settled result for this link, if one is kept. */
  peek(ref: DocRef): DocPreviewResult | undefined;
}

const key = (r: DocRef) => `${r.scope}:${r.kind}:${r.id}`;

/** Previews per link, shared by every mention of it in the conversation. Two
 *  hovers in flight share one fetch. A failure other than "not found" is not
 *  kept, so the next hover tries again (the runtime may have been down). */
export function createDocPreviewCache(call: DocumentCall): DocPreviewCache {
  const pending = new Map<string, Promise<DocPreviewResult>>();
  const settled = new Map<string, DocPreviewResult>();
  return {
    load(ref) {
      const k = key(ref);
      const done = settled.get(k);
      if (done) return Promise.resolve(done);
      let p = pending.get(k);
      if (!p) {
        p = loadDocPreview(call, ref).then((res) => {
          pending.delete(k);
          if (res.ok || res.notFound) settled.set(k, res);
          return res;
        });
        pending.set(k, p);
      }
      return p;
    },
    peek: (ref) => settled.get(key(ref)),
  };
}
