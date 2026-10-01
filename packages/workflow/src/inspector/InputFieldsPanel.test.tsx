// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputFieldsPanel } from "./InputFieldsPanel";
import type { InputField } from "../lib/inputForm";

afterEach(cleanup);

describe("InputFieldsPanel", () => {
  it("adds a field as required and bound to the variable of the same name", () => {
    const onChange = vi.fn();
    render(<InputFieldsPanel fields={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("New field name"), { target: { value: "document_id" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(onChange).toHaveBeenCalledWith([{ name: "document_id", type: "string", required: true, variable: "document_id" }]);
  });

  it("refuses a name the runtime would refuse as a variable, or one already used", () => {
    const { rerender } = render(<InputFieldsPanel fields={[]} onChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("New field name"), { target: { value: "doc.id" } });
    expect((screen.getByRole("button", { name: "Add field" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<InputFieldsPanel fields={[{ name: "x", type: "string", required: false }]} onChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("New field name"), { target: { value: "x" } });
    expect((screen.getByRole("button", { name: "Add field" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("makes a chunk picker follow the document field, top-level sections only", () => {
    const onChange = vi.fn();
    const fields: InputField[] = [
      { name: "document_id", type: "string", required: true, picker: { kind: "document", scope: "user" } },
      { name: "chunk_id", type: "string", required: true },
    ];
    render(<InputFieldsPanel fields={fields} onChange={onChange} />);
    fireEvent.change(screen.getAllByLabelText("Picker")[1], { target: { value: "chunk" } });
    expect(onChange.mock.calls[0][0][1].picker).toEqual({ kind: "chunk", document: "document_id", depth: 1 });
  });

  it("unbinds a field's variable", () => {
    const onChange = vi.fn();
    render(<InputFieldsPanel fields={[{ name: "a", type: "string", required: true, variable: "a" }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /bind as/ }));
    expect(onChange.mock.calls[0][0][0].variable).toBeUndefined();
  });
});
