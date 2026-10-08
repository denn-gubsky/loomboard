// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { SavedTeam, TeamDefDetail, WorkflowDataLayer } from "./types";

// RFC DX phase 4: building a team by hand — a new team from a template, a
// copy under a new name, and a definition taken out or brought in as text.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const definition = {
  entry: "write",
  states: [
    { state: "write", handler: { kind: "agent", agent: "writer" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [{ from: "write", to: "done", on: "success" }],
};

function layer(o: Partial<WorkflowDataLayer> = {}) {
  const active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition };
  const forkTeam = vi.fn(async (_n: string, _d: unknown): Promise<SavedTeam> => ({ def_id: "d2", name: "blog", version: 2 }));
  const createTeam = vi.fn(async (name: string, _d: unknown): Promise<SavedTeam> => ({ def_id: "n1", name, version: 1 }));
  const l: WorkflowDataLayer = {
    listTeams: async () => [{ name: "blog", active_def_id: "d1" }],
    getActiveTeamDef: async () => active,
    getTeamDef: async () => active,
    createTeam,
    forkTeam,
    ...o,
  };
  return { l, forkTeam, createTeam };
}

/** An item of the "Team file" menu, opened first as an operator would. */
function menuItem(name: string | RegExp) {
  fireEvent.click(screen.getByText("Team file"));
  return screen.getByRole("button", { name });
}

function nameTheTeam(name: string) {
  fireEvent.change(screen.getByLabelText("Team name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Create team" }));
}

describe("WorkflowCanvas — a new team from a template (RFC DX)", () => {
  it("opens the template as an unnamed draft that can be created but not versioned or run", async () => {
    const { l } = layer({ runTeamDetached: vi.fn() });
    render(<WorkflowCanvas dataLayer={l} template={definition} />);
    await screen.findByTestId("node-write");
    expect(screen.getByText("New team")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save new version" })).toBeNull();
    expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Create team…" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("creates the team under the name given, positions included, and tells the host which team it is", async () => {
    const onSaved = vi.fn();
    const { l, createTeam, forkTeam } = layer();
    render(<WorkflowCanvas dataLayer={l} template={definition} onSaved={onSaved} />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Create team…" }));
    nameTheTeam("press");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ def_id: "n1", name: "press", version: 1 }));
    const [name, sent] = createTeam.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("press");
    expect(sent.states).toEqual(definition.states);
    expect(Object.keys((sent.layout as { nodes: object }).nodes)).toEqual(["write", "done"]);
    expect(forkTeam).not.toHaveBeenCalled();
    // It is that team now: the next save adds a version to it.
    expect(screen.getByText("press")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save new version" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Save as a new team" })).toBeNull();
  });

  it("refuses a name another team has, in the dialog, and creates nothing", async () => {
    const { l, createTeam } = layer();
    render(<WorkflowCanvas dataLayer={l} template={definition} />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Create team…" }));
    nameTheTeam("blog");
    expect(await screen.findByText(/a team named "blog" already exists/)).toBeTruthy();
    expect(createTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Save as a new team" })).toBeTruthy();
  });

  it("says why a name is outside the runtime's grammar before it can be sent", async () => {
    const { l } = layer();
    render(<WorkflowCanvas dataLayer={l} template={definition} />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByRole("button", { name: "Create team…" }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "my team" } });
    expect(screen.getByText(/one segment of A-Z a-z 0-9 _ -/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create team" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("WorkflowCanvas — the Team file menu (RFC DX)", () => {
  it("saves the team shown as a new team, leaving the one it came from alone", async () => {
    const onSaved = vi.fn();
    const { l, createTeam, forkTeam } = layer();
    render(<WorkflowCanvas dataLayer={l} teamName="blog" onSaved={onSaved} />);
    await screen.findByTestId("node-write");
    fireEvent.click(menuItem("Save as new team…"));
    nameTheTeam("blog-2");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ def_id: "n1", name: "blog-2", version: 1 }));
    expect((createTeam.mock.calls[0] as [string, { states: unknown }])[1].states).toEqual(definition.states);
    expect(forkTeam).not.toHaveBeenCalled();
  });

  it("imports a pasted definition as the draft, saved only by the next save", async () => {
    const { l, forkTeam, createTeam } = layer();
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(menuItem("Import…"));
    const text = screen.getByLabelText("Or paste the definition");

    fireEvent.change(text, { target: { value: '{\n  "states": [}' } });
    fireEvent.click(screen.getByRole("button", { name: "Replace the draft" }));
    expect(screen.getByText(/^Line 2, column \d+:/)).toBeTruthy();
    expect(screen.getByTestId("node-write")).toBeTruthy();

    const imported = {
      entry: "review",
      states: [
        { state: "review", handler: { kind: "agent", agent: "critic" } },
        { state: "end", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "review", to: "end", on: "success" }],
    };
    fireEvent.change(text, { target: { value: JSON.stringify({ def_id: "tdf_9", name: "other", definition: imported }) } });
    fireEvent.click(screen.getByRole("button", { name: "Replace the draft" }));
    await screen.findByTestId("node-review");
    expect(screen.queryByTestId("node-write")).toBeNull();
    expect(forkTeam).not.toHaveBeenCalled();
    expect(createTeam).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(forkTeam).toHaveBeenCalled());
    expect((forkTeam.mock.calls[0] as [string, { states: unknown }])[1].states).toEqual(imported.states);
  });

  it("copies the definition as it would be saved, positions included", async () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { l } = layer();
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(menuItem("Copy JSON"));
    await screen.findByText("Copied the definition.");
    const copied = JSON.parse(writeText.mock.calls[0][0]);
    expect(copied.states).toEqual(definition.states);
    expect(Object.keys(copied.layout.nodes)).toEqual(["write", "done"]);
  });

  it("downloads the definition as <team>.json", async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    let downloaded: string | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    const { l } = layer();
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    await screen.findByTestId("node-write");
    fireEvent.click(menuItem("Download .json"));
    expect(downloaded).toBe("blog.json");
    expect(JSON.parse(await blobs[0].text()).states).toEqual(definition.states);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    click.mockRestore();
  });

  it("offers a read-only host Copy and Download, and nothing that changes a team", async () => {
    const { l } = layer();
    render(<WorkflowCanvas dataLayer={l} teamName="blog" mode="readonly" />);
    await screen.findByTestId("node-write");
    fireEvent.click(screen.getByText("Team file"));
    expect(screen.getByRole("button", { name: "Copy JSON" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download .json" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save as new team…" })).toBeNull();
  });
});
