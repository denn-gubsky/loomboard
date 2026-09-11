// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Renders the Canvas surface through the APP's module resolution.
//
// WHY this exists separately from the package's own render tests: those pass,
// and the surface still came up blank in the browser. The difference is
// resolution context — the app consumes @loomboard/workflow from source via a
// Vite alias, so its React, its @xyflow/react and its @loomcycle/def-fields
// are resolved from the app's tree, not the package's. A component that mounts
// cleanly inside the package can still throw here, and when it throws during
// render React unmounts the whole tree: no canvas, no sidebar, no error on
// screen. This test is the only place that reproduces that.

// xyflow measures its viewport; jsdom implements none of it. Same shims the
// package uses — see packages/workflow/vitest.setup.ts.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  for (const prop of ["offsetWidth", "offsetHeight"] as const) {
    if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)?.get) {
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        value: prop === "offsetWidth" ? 800 : 600,
      });
    }
  }
});

const listTeams = vi.fn(async () => ({ names: [{ name: "sdlc", active_def_id: "def-1" }] }));
const getTeamDef = vi.fn(async () => ({
  def_id: "def-1",
  name: "sdlc",
  version: 1,
  definition: {
    entry: "start",
    states: [
      { state: "start", handler: { kind: "agent", agent: "a" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "start", to: "done", on: "success" }],
  },
}));
const listLibraryAgents = vi.fn(async () => ({ entries: [{ name: "a" }] }));

// Stub the connection rather than standing up a provider: useLoomcycle throws
// when not connected, and what is under test is the canvas, not the login.
vi.mock("../../state/connection", () => ({
  useLoomcycle: () => ({ listTeams, getTeamDef, listLibraryAgents, createTeam: vi.fn(), forkTeam: vi.fn(), runTeam: vi.fn() }),
  useConnection: () => ({ status: "connected", capabilities: { canTenant: true } }),
}));

afterEach(cleanup);

describe("CanvasArea", () => {
  it("mounts without throwing and renders the team picker", async () => {
    const { default: CanvasArea } = await import("./CanvasArea");
    render(<CanvasArea />);
    // The picker is the surface's own chrome; if the tree threw, nothing at
    // all would be in the document.
    expect(await screen.findByText(/Team/)).toBeTruthy();
  });

  it("loads the selected team and draws its states", async () => {
    const { default: CanvasArea } = await import("./CanvasArea");
    render(<CanvasArea />);
    expect(await screen.findByTestId("node-start")).toBeTruthy();
    expect(await screen.findByTestId("node-done")).toBeTruthy();
  });
});
