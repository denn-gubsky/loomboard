// Document links: how an agent cites a loomcycle document or chunk so the chat
// can preview and open it. The format is a Markdown link with a `loom:` address,
// taught to every agent by the Document tool's own guide (loomcycle G29):
//
//   [Release plan](loom:doc/<document_id>)
//   [Timeline](loom:chunk/<chunk_id>?scope=tenant)
//
// The kind is part of the address because document and chunk ids share one
// shape (32 hex), and `get_chunk` with a document id is "no such chunk". The
// scope is there because an id resolves only in the scope it was read in.

export type DocRefKind = "doc" | "chunk";
export type DocRefScope = "user" | "tenant" | "agent";

export interface DocRef {
  kind: DocRefKind;
  id: string;
  scope: DocRefScope;
}

// Strict on purpose: this decides which hrefs get past the Markdown URL
// sanitizer, so anything that is not exactly this shape stays a plain link and
// gets the default treatment.
const DOC_REF_URL = /^loom:(doc|chunk)\/([0-9a-f]{32})(?:\?scope=(user|tenant|agent))?$/;

/** The reference a `loom:` link names, or null when the href is anything else. */
export function parseDocRef(href: string): DocRef | null {
  const m = DOC_REF_URL.exec(href);
  if (!m) return null;
  return { kind: m[1] as DocRefKind, id: m[2], scope: (m[3] as DocRefScope | undefined) ?? "user" };
}

/** One id in a Document tool result that gets link controls. `start`/`end` are
 *  the id's own span in the result text. */
export interface ResultRef {
  start: number;
  end: number;
  ref: DocRef;
}

// Keys whose value is always a chunk or document id, whatever the op.
const CHUNK_KEYS = new Set(["chunk_id", "root_chunk_id", "parent_id", "from_id", "to_id"]);
// `id` is a chunk id only in what these ops return; elsewhere it is a document's
// or a statement's (get_edges rows carry the statement's `id` beside from_id/to_id).
const CHUNK_ID_OPS = new Set(["get_chunk", "create_chunk", "update_chunk", "upsert_chunk", "supersede_chunk", "move_chunk"]);
// A copy or move answers with ids in `to_scope`, not the call's scope; rather
// than half-link them, these ops get no links.
const SKIP_OPS = new Set(["copy_documents", "move_documents"]);

const ID_FIELD = /"(document_id|chunk_id|root_chunk_id|parent_id|from_id|to_id|id)"\s*:\s*"([0-9a-f]{32})"/g;

// The wire types a tool's input as unknown; it may come as the object or as
// its JSON text.
function inputObject(input: unknown): { op?: unknown; scope?: unknown } | null {
  let v = input;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function isScope(v: unknown): v is DocRefScope {
  return v === "user" || v === "tenant" || v === "agent";
}

/** The ids in a Document tool result that can be previewed and opened, in
 *  order. Reads the op and scope from the call's own input, so each id is
 *  resolved where the agent read it. Empty for any other tool. */
export function refsInToolResult(name: string, input: unknown, result: string): ResultRef[] {
  if (name !== "Document") return [];
  const args = inputObject(input);
  if (!args) return [];
  const { op, scope } = args;
  if (typeof op !== "string" || SKIP_OPS.has(op)) return [];
  const sc: DocRefScope = isScope(scope) ? scope : "user";
  const out: ResultRef[] = [];
  for (const m of result.matchAll(ID_FIELD)) {
    const [whole, key, id] = m;
    let kind: DocRefKind | null = null;
    if (key === "document_id") kind = "doc";
    else if (CHUNK_KEYS.has(key)) kind = "chunk";
    else if (CHUNK_ID_OPS.has(op)) kind = "chunk";
    if (!kind) continue;
    const end = (m.index ?? 0) + whole.length - 1; // before the closing quote
    out.push({ start: end - id.length, end, ref: { kind, id, scope: sc } });
  }
  return out;
}
