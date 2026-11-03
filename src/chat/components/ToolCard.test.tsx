// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import ToolCard from "./ToolCard";
import { createDocPreviewCache } from "../lib/docPreview";
import { DocLinksContext } from "../hooks/useDocLinks";

// A Document tool card links the ids its result names (lib/docRefs decides
// which); every other result stays plain text.

const DOC = "b4407b522dc11495d3de371311db17f0";
const CHUNK = "5d8e2f1a0b9c4d3e7f6a5b4c3d2e1f00";

function withLinks(ui: ReactNode, open?: () => void) {
  return render(
    <section className="loomchat">
      <DocLinksContext.Provider value={{ previews: createDocPreviewCache(async () => ({})), open }}>
        {ui}
      </DocLinksContext.Provider>
    </section>,
  );
}

afterEach(cleanup);
describe("ToolCard — Document results", () => {
  it("gives each id in a Document result the link controls and keeps the text as it was", () => {
    const result = JSON.stringify({ chunks: [{ chunk_id: CHUNK, document_id: DOC, score: 0.8 }] }, null, 2);
    withLinks(<ToolCard call={{ id: "t1", name: "Document", input: { op: "search", query: "beta" }, result }} />, () => {});
    fireEvent.click(screen.getByRole("button", { name: /Document/ }));
    expect(screen.getByRole("button", { name: `Preview section ${CHUNK}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Open document ${DOC}` })).toBeTruthy();
    const pres = document.querySelectorAll(".tool-pre"); // input, then result
    expect(pres[pres.length - 1].textContent).toBe(result);
  });

  it("leaves another tool's result, and a failed call, as plain text", () => {
    const result = JSON.stringify({ document_id: DOC });
    withLinks(
      <>
        <ToolCard call={{ id: "t1", name: "Path", input: { op: "resolve" }, result }} />
        <ToolCard call={{ id: "t2", name: "Document", input: { op: "get_document" }, result, isError: true }} />
      </>,
      () => {},
    );
    for (const head of screen.getAllByRole("button")) fireEvent.click(head);
    expect(screen.queryByRole("button", { name: /^Preview/ })).toBeNull();
  });
});
