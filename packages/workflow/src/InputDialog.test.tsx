// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputDialog } from "./InputDialog";
import type { FormResult, InputField, StartPlan } from "./lib/inputForm";

afterEach(cleanup);

// The pcparts form: {document_id, chunk_id}, both picked.
const FIELDS: InputField[] = [
  { name: "document_id", title: "Document", type: "string", required: true, picker: { kind: "document", scope: "user", underPath: "/loomboard/tests" }, variable: "document_id" },
  { name: "chunk_id", title: "Part", type: "string", required: true, picker: { kind: "chunk", document: "document_id", depth: 1 }, variable: "chunk_id" },
];
const PLAN: StartPlan = { input: "form", next: "research", publishTo: "pcparts-in" };

const listDocuments = vi.fn(async () => [
  { id: "doc-parts", title: "PC Parts Catalog" },
  { id: "doc-other", title: "Other" },
]);
const listChunks = vi.fn(async (documentId: string) =>
  documentId === "doc-parts"
    ? [
        { id: "root", title: "PC Parts Catalog", position: 0, parent_id: null },
        { id: "cpu", title: "AMD Ryzen 7 7800X3D", position: 0, parent_id: "root" },
        { id: "cpu-r", title: "Research: Ryzen", position: 0, parent_id: "cpu" },
        { id: "gpu", title: "RTX 4070 Super", position: 1, parent_id: "root" },
      ]
    : [{ id: "r2", title: "Other", position: 0, parent_id: null }, { id: "x", title: "Something", position: 0, parent_id: "r2" }],
);

const dialog = (o: Partial<Parameters<typeof InputDialog>[0]> = {}) => {
  const onStart = vi.fn((_f: FormResult) => undefined);
  render(
    <InputDialog fields={FIELDS} plan={PLAN} listDocuments={listDocuments} listChunks={listChunks} onStart={onStart} onClose={() => undefined} {...o} />,
  );
  return onStart;
};

describe("InputDialog", () => {
  it("picks the document, then a part of it, and starts with {document_id, chunk_id}", async () => {
    const onStart = dialog();
    const doc = (await screen.findByLabelText(/Document/)) as HTMLSelectElement;
    await waitFor(() => expect(doc.disabled).toBe(false));
    expect(listDocuments).toHaveBeenCalledWith({ scope: "user", underPath: "/loomboard/tests" });
    fireEvent.change(doc, { target: { value: "doc-parts" } });

    const part = (await screen.findByLabelText(/Part/)) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole("option", { name: /RTX 4070 Super/ })).toBeTruthy());
    // Top-level sections only (depth 1): the parts, not their research chunks.
    expect(screen.queryByRole("option", { name: /Research: Ryzen/ })).toBeNull();
    fireEvent.change(part, { target: { value: "gpu" } });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onStart.mock.calls[0][0].input)).toEqual({ document_id: "doc-parts", chunk_id: "gpu" });
  });

  it("clears the chosen part when the document changes — a chunk of A sent with B would be a silent mismatch", async () => {
    const onStart = dialog();
    const doc = (await screen.findByLabelText(/Document/)) as HTMLSelectElement;
    await waitFor(() => expect(doc.disabled).toBe(false));
    fireEvent.change(doc, { target: { value: "doc-parts" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /RTX 4070 Super/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Part/), { target: { value: "gpu" } });
    fireEvent.change(doc, { target: { value: "doc-other" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).not.toHaveBeenCalled();
    expect(await screen.findByText("required")).toBeTruthy();
  });

  it("says where Start puts the form, and refuses while blocked", () => {
    const onStart = dialog({ blocked: "Save a new version first" });
    expect(screen.getByRole("dialog").textContent).toContain("pcparts-in");
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("falls back to typing an id when the host cannot list documents", async () => {
    const onStart = dialog({ listDocuments: vi.fn(async () => Promise.reject(new Error("offline"))) });
    const doc = await screen.findByRole("textbox", { name: /Document/ });
    fireEvent.change(doc, { target: { value: "typed-doc" } });
    // The part picker has no document list to follow yet; it still offers
    // the chunks once a document id is there.
    await waitFor(() => expect(listChunks).toHaveBeenCalledWith("typed-doc", { scope: "user" }));
    expect(onStart).not.toHaveBeenCalled();
  });
});
