import { describe, expect, it, vi } from "vitest";
import { LoomcycleError } from "@loomcycle/client";
import { createDocPreviewCache, excerpt, loadDocPreview, type DocumentCall } from "./docPreview";
import type { DocRef } from "./docRefs";

const DOC = "b4407b522dc11495d3de371311db17f0";
const ROOT = "9e1c3a7d2b5f4e6081a2c3d4e5f60718";
const CHUNK = "5d8e2f1a0b9c4d3e7f6a5b4c3d2e1f00";

const docRef: DocRef = { kind: "doc", id: DOC, scope: "tenant" };
const chunkRef: DocRef = { kind: "chunk", id: CHUNK, scope: "user" };

// A store with one document: its root and one section.
function store(): DocumentCall {
  return vi.fn(async ({ op, id }) => {
    if (op === "get_document" && id === DOC) {
      return { document_id: DOC, title: "Release plan", root_chunk_id: ROOT, type: "plan", tags: ["release"] };
    }
    if (op === "get_chunk" && id === ROOT) return { id: ROOT, document_id: DOC, title: "Release plan", body: "Ships in **March**." };
    if (op === "get_chunk" && id === CHUNK) {
      return { id: CHUNK, document_id: DOC, title: "Timeline", body: "Beta on 1 March.", type: "section", tags: ["dates"] };
    }
    throw new LoomcycleError("Unprocessable Entity", {
      status: 422,
      bodyText: JSON.stringify({ code: "tool_refused", error: `${op}: no such ${op === "get_chunk" ? "chunk" : "document"}: ${id}` }),
    });
  });
}

describe("excerpt", () => {
  it("keeps a short body whole", () => {
    expect(excerpt("  short body \n")).toEqual({ text: "short body", truncated: false });
  });

  it("cuts a long body back to the last whole word", () => {
    const { text, truncated } = excerpt("alpha beta gamma delta", 13);
    expect(truncated).toBe(true);
    expect(text).toBe("alpha beta");
  });
});

describe("loadDocPreview", () => {
  it("previews a document with its root chunk's body as the excerpt", async () => {
    const call = store();
    const res = await loadDocPreview(call, docRef);
    expect(res).toEqual({
      ok: true,
      preview: { documentId: DOC, title: "Release plan", type: "plan", tags: ["release"], excerpt: "Ships in **March**.", truncated: false },
    });
    // Both reads in the link's own scope.
    expect(call).toHaveBeenCalledWith({ op: "get_document", id: DOC, scope: "tenant" });
    expect(call).toHaveBeenCalledWith({ op: "get_chunk", id: ROOT, scope: "tenant" });
  });

  it("previews a chunk with the title of the document that holds it", async () => {
    const res = await loadDocPreview(store(), chunkRef);
    expect(res).toEqual({
      ok: true,
      preview: {
        documentId: DOC,
        chunkId: CHUNK,
        title: "Timeline",
        documentTitle: "Release plan",
        type: "section",
        tags: ["dates"],
        excerpt: "Beta on 1 March.",
        truncated: false,
      },
    });
  });

  it("leaves out the document's title when the chunk is that document's root", async () => {
    const res = await loadDocPreview(store(), { kind: "chunk", id: ROOT, scope: "user" });
    expect(res.ok && res.preview.title).toBe("Release plan");
    expect(res.ok && res.preview.documentTitle).toBeUndefined();
  });

  it("reports an id the store does not hold as not found, with the runtime's reason", async () => {
    const res = await loadDocPreview(store(), { kind: "chunk", id: DOC, scope: "user" });
    expect(res).toEqual({ ok: false, notFound: true, reason: `get_chunk: no such chunk: ${DOC}` });
  });

  it("reports an access refusal as unavailable but not as missing", async () => {
    const call: DocumentCall = async () => {
      throw new LoomcycleError("Forbidden", { status: 403, code: "acl_denied", bodyText: JSON.stringify({ code: "acl_denied", action: "read", resource: "document" }) });
    };
    const res = await loadDocPreview(call, docRef);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.notFound).toBe(false);
      expect(res.reason).toMatch(/^Access denied/);
    }
  });

  it("still previews a document whose root chunk cannot be read", async () => {
    const call: DocumentCall = async ({ op }) => {
      if (op === "get_document") return { document_id: DOC, title: "Release plan", root_chunk_id: ROOT };
      throw new Error("boom");
    };
    const res = await loadDocPreview(call, docRef);
    expect(res.ok && res.preview.title).toBe("Release plan");
    expect(res.ok && res.preview.excerpt).toBe("");
  });
});

describe("createDocPreviewCache", () => {
  it("shares one fetch between concurrent loads of the same link", async () => {
    const call = store();
    const cache = createDocPreviewCache(call);
    const [a, b] = await Promise.all([cache.load(chunkRef), cache.load(chunkRef)]);
    expect(a).toBe(b);
    expect(call).toHaveBeenCalledTimes(2); // get_chunk + get_document, once
    expect(cache.peek(chunkRef)).toBe(a);
  });

  it("keeps a not-found answer but retries a transient failure", async () => {
    let up = false;
    const call: DocumentCall = async ({ op, id }) => {
      if (!up) throw new TypeError("Failed to fetch");
      if (op === "get_document" && id === DOC) return { document_id: DOC, title: "Release plan" };
      throw new Error(`${op}: no such chunk: ${id}`);
    };
    const cache = createDocPreviewCache(call);
    expect((await cache.load(docRef)).ok).toBe(false);
    expect(cache.peek(docRef)).toBeUndefined();
    up = true;
    expect((await cache.load(docRef)).ok).toBe(true);
    const missing = await cache.load(chunkRef);
    expect(missing).toMatchObject({ ok: false, notFound: true });
    expect(cache.peek(chunkRef)).toBe(missing);
  });
});
