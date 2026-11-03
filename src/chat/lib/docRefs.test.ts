import { describe, expect, it } from "vitest";
import { parseDocRef, refsInToolResult } from "./docRefs";

const DOC = "b4407b522dc11495d3de371311db17f0";
const CHUNK = "5d8e2f1a0b9c4d3e7f6a5b4c3d2e1f00";

describe("parseDocRef", () => {
  it("reads a document link in the user scope by default", () => {
    expect(parseDocRef(`loom:doc/${DOC}`)).toEqual({ kind: "doc", id: DOC, scope: "user" });
  });

  it("reads a chunk link with its stated scope", () => {
    expect(parseDocRef(`loom:chunk/${CHUNK}?scope=tenant`)).toEqual({ kind: "chunk", id: CHUNK, scope: "tenant" });
    expect(parseDocRef(`loom:chunk/${CHUNK}?scope=agent`)?.scope).toBe("agent");
  });

  it.each([
    ["an uppercase id", `loom:doc/${DOC.toUpperCase()}`],
    ["a short id", `loom:doc/${DOC.slice(1)}`],
    ["a long id", `loom:doc/${DOC}0`],
    ["an unknown kind", `loom:document/${DOC}`],
    ["an unknown scope", `loom:doc/${DOC}?scope=global`],
    ["an extra query", `loom:doc/${DOC}?scope=user&x=1`],
    ["an extra path segment", `loom:doc/${DOC}/x`],
    ["a script address", "loom:javascript:alert(1)"],
    ["another scheme", `https://example.com/loom:doc/${DOC}`],
    ["a leading space", ` loom:doc/${DOC}`],
  ])("rejects %s", (_, href) => {
    expect(parseDocRef(href)).toBeNull();
  });
});

describe("refsInToolResult", () => {
  it("links the id fields of a Document result at their exact spans, in the call's scope", () => {
    const result = JSON.stringify({ document_id: DOC, root_chunk_id: CHUNK, title: "Plan" });
    const refs = refsInToolResult("Document", { op: "get_document", id: DOC, scope: "tenant" }, result);
    expect(refs.map((r) => r.ref)).toEqual([
      { kind: "doc", id: DOC, scope: "tenant" },
      { kind: "chunk", id: CHUNK, scope: "tenant" },
    ]);
    for (const r of refs) expect(result.slice(r.start, r.end)).toBe(r.ref.id);
  });

  it("treats `id` as a chunk only on the ops that answer with a chunk", () => {
    const chunk = JSON.stringify({ id: CHUNK, document_id: DOC });
    expect(refsInToolResult("Document", { op: "get_chunk" }, chunk).map((r) => r.ref.kind)).toEqual(["chunk", "doc"]);
    // get_edges rows: `id` is the statement, from_id/to_id are the chunks.
    const edges = JSON.stringify({ edges: [{ id: DOC, from_id: CHUNK, to_id: CHUNK, kind: "cites" }] });
    const refs = refsInToolResult("Document", { op: "get_edges" }, edges);
    expect(refs.map((r) => r.ref.id)).toEqual([CHUNK, CHUNK]);
  });

  it("links search hits in a pretty-printed result", () => {
    const result = JSON.stringify({ chunks: [{ chunk_id: CHUNK, document_id: DOC, score: 0.8 }] }, null, 2);
    expect(refsInToolResult("Document", { op: "search" }, result)).toHaveLength(2);
  });

  it("links nothing for other tools, copies and moves, or a malformed input", () => {
    const result = JSON.stringify({ document_id: DOC });
    expect(refsInToolResult("Path", { op: "resolve" }, result)).toEqual([]);
    expect(refsInToolResult("Document", { op: "copy_documents" }, result)).toEqual([]);
    expect(refsInToolResult("Document", { op: "move_documents" }, result)).toEqual([]);
    expect(refsInToolResult("Document", "get_document", result)).toEqual([]);
    expect(refsInToolResult("Document", {}, result)).toEqual([]);
  });

  it("reads the op and scope from an input given as JSON text", () => {
    const result = JSON.stringify({ document_id: DOC });
    const refs = refsInToolResult("Document", JSON.stringify({ op: "get_document", scope: "tenant" }), result);
    expect(refs.map((r) => r.ref)).toEqual([{ kind: "doc", id: DOC, scope: "tenant" }]);
    expect(refsInToolResult("Document", "not json", result)).toEqual([]);
  });

  it("falls back to the user scope when the input's scope is not a scope", () => {
    const result = JSON.stringify({ document_id: DOC });
    expect(refsInToolResult("Document", { op: "get_document", scope: "everyone" }, result)[0].ref.scope).toBe("user");
  });
});
