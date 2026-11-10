// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import Markdown from "./Markdown";
import { createDocPreviewCache, type DocumentCall } from "../lib/docPreview";
import { DocLinksContext, type DocumentOpenTarget } from "../hooks/useDocLinks";

// Document links through the real Markdown pipeline: what an agent's `loom:`
// link becomes, what the two controls do, and that ordinary links are untouched.

const DOC = "b4407b522dc11495d3de371311db17f0";
const CHUNK = "5d8e2f1a0b9c4d3e7f6a5b4c3d2e1f00";
const GONE = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

const call: DocumentCall = async ({ op, id }) => {
  if (op === "get_document" && id === DOC) return { document_id: DOC, title: "Release plan" };
  if (op === "get_chunk" && id === CHUNK) return { id: CHUNK, document_id: DOC, title: "Timeline", body: "Beta on **1 March**." };
  throw new Error(`${op}: no such chunk: ${id}`);
};

function withLinks(ui: ReactNode, open?: (t: DocumentOpenTarget) => void) {
  return render(
    <section className="loomchat">
      <DocLinksContext.Provider value={{ previews: createDocPreviewCache(call), open }}>{ui}</DocLinksContext.Provider>
    </section>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Markdown — document links", () => {
  it("renders a loom: link as the title with preview and open controls, not an anchor", () => {
    withLinks(<Markdown>{`See [Timeline](loom:chunk/${CHUNK}).`}</Markdown>, () => {});
    expect(screen.getByText("Timeline").closest("a")).toBeNull();
    expect(screen.getByRole("button", { name: "Preview section Timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open section Timeline" })).toBeTruthy();
  });

  it("previews only, with no open control, when the host cannot open documents", () => {
    withLinks(<Markdown>{`[Release plan](loom:doc/${DOC})`}</Markdown>);
    expect(screen.getByRole("button", { name: "Preview document Release plan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Open/ })).toBeNull();
  });

  it("renders the title alone outside a chat", () => {
    render(<Markdown>{`[Release plan](loom:doc/${DOC})`}</Markdown>);
    expect(screen.getByText("Release plan").className).toBe("docref");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leaves ordinary links as anchors, still sanitized, and a malformed loom: link inert", () => {
    render(
      <Markdown>
        {`[site](https://example.com) [bad](javascript:alert(1)) [odd](loom:doc/${DOC.toUpperCase()})`}
      </Markdown>,
    );
    expect(screen.getByText("site").closest("a")?.getAttribute("href")).toBe("https://example.com");
    expect(screen.getByText("bad").closest("a")?.getAttribute("href")).toBe("");
    expect(screen.getByText("odd").closest("a")?.getAttribute("href")).toBe("");
  });
});

describe("DocRef", () => {
  it("shows the preview after a short hover, in the chat root, with the excerpt rendered", async () => {
    vi.useFakeTimers();
    withLinks(<Markdown>{`[Timeline](loom:chunk/${CHUNK})`}</Markdown>);
    const ctl = screen.getByRole("button", { name: "Preview section Timeline" });
    fireEvent.pointerEnter(ctl, { pointerType: "mouse" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const pop = screen.getByRole("dialog", { name: "Preview of Timeline" });
    expect(pop.parentElement?.className).toBe("loomchat");
    expect(pop.textContent).toContain("in Release plan");
    expect(pop.querySelector("strong")?.textContent).toBe("1 March");
  });

  it("toggles the preview on a tap, and Escape closes it without reaching the window", async () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    withLinks(<Markdown>{`[Release plan](loom:doc/${DOC})`}</Markdown>);
    const ctl = screen.getByRole("button", { name: "Preview document Release plan" });
    fireEvent.pointerDown(ctl, { pointerType: "touch" });
    fireEvent.click(ctl);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(ctl, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  it("opens a document link straight away, in its scope", () => {
    const open = vi.fn();
    withLinks(<Markdown>{`[Release plan](loom:doc/${DOC}?scope=tenant)`}</Markdown>, open);
    fireEvent.click(screen.getByRole("button", { name: "Open document Release plan" }));
    expect(open).toHaveBeenCalledWith({ documentId: DOC, scope: "tenant", title: "Release plan" });
  });

  it("opens a chunk link at its chunk, in the document the chunk belongs to", async () => {
    const open = vi.fn();
    withLinks(<Markdown>{`[Timeline](loom:chunk/${CHUNK})`}</Markdown>, open);
    fireEvent.click(screen.getByRole("button", { name: "Open section Timeline" }));
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith({ documentId: DOC, chunkId: CHUNK, scope: "user", title: "Timeline" }),
    );
  });

  it("explains an id that resolves to nothing instead of opening it, and drops its open control", async () => {
    const open = vi.fn();
    withLinks(<Markdown>{`[Ghost](loom:chunk/${GONE})`}</Markdown>, open);
    fireEvent.click(screen.getByRole("button", { name: "Open section Ghost" }));
    const pop = await screen.findByRole("dialog");
    await vi.waitFor(() => expect(pop.textContent).toContain("Not found"));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText("Ghost").className).toBe("docref missing");
    expect(screen.queryByRole("button", { name: "Open section Ghost" })).toBeNull();
  });

  it("leads with the annotation's brief, shows its abstract instead of the excerpt, and marks it stale", async () => {
    const annotated: DocumentCall = async ({ op, id, with_summary }) => {
      if (op === "get_chunk" && id === CHUNK) {
        return {
          id: CHUNK,
          document_id: DOC,
          title: "Timeline",
          body: "Beta on **1 March**.",
          ...(with_summary ? { summary: { level: "branch", brief: "The beta date.", abstract: "Beta opens on 1 March.", stale: true } } : {}),
          ...(with_summary ? { document_summary: { brief: "How the release ships." } } : {}),
        };
      }
      if (op === "get_document" && id === DOC) return { document_id: DOC, title: "Release plan" };
      throw new Error(`${op}: no such chunk: ${id}`);
    };
    render(
      <section className="loomchat">
        <DocLinksContext.Provider value={{ previews: createDocPreviewCache(annotated) }}>
          <Markdown>{`[Timeline](loom:chunk/${CHUNK}?scope=tenant)`}</Markdown>
        </DocLinksContext.Provider>
      </section>,
    );
    const ctl = screen.getByRole("button", { name: "Preview section Timeline" });
    fireEvent.pointerDown(ctl, { pointerType: "touch" });
    fireEvent.click(ctl);
    const pop = await screen.findByRole("dialog");
    await vi.waitFor(() => expect(pop.textContent).toContain("The beta date."));
    expect(pop.querySelector(".docref-pop-brief")?.textContent).toBe("The beta date.stale");
    expect(pop.querySelector(".docref-pop-abstract")?.textContent).toBe("Beta opens on 1 March.");
    // The excerpt is the fallback, not shown beside the abstract.
    expect(pop.querySelector(".docref-pop-excerpt")).toBeNull();
    expect(pop.querySelector(".docref-pop-docbrief")?.textContent).toBe("Release plan: How the release ships.");
  });
});
