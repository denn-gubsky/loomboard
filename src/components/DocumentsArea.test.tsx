// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { NavigatorContext, PathExplorer as RealPathExplorer } from "@loomcycle/explorer";
import DocumentsArea from "./DocumentsArea";

// The explorer shows its `tree | stars` toggle only when the host supplies
// renderNavigator. This fake explorer calls the slot the way the real one does
// when a reader flips to `stars`, so the test checks the wiring end to end:
// the lazy pane resolves, and it receives the explorer's ctx and loomboard's
// connection.
const ctx: NavigatorContext = {
  scope: "tenant",
  selection: { documentId: "doc-1" },
  onSelect: vi.fn(),
  reloadToken: 3,
  maximized: false,
  onToggleMaximize: vi.fn(),
  subject: "ada",
};

vi.mock("@loomcycle/explorer", () => ({
  PathExplorer: (props: ComponentProps<typeof RealPathExplorer>) => (
    <div data-testid="explorer">{props.renderNavigator ? props.renderNavigator(ctx) : "tree only"}</div>
  ),
  DocumentViewer: () => <div data-testid="viewer" />,
}));

vi.mock("./UniverseNavigatorPane", () => ({
  default: ({ ctx, connection }: { ctx: NavigatorContext; connection: { baseUrl: string } }) => (
    <div data-testid="stars">
      {ctx.scope}/{ctx.subject}/{ctx.reloadToken}@{connection.baseUrl}
    </div>
  ),
}));

vi.mock("../state/connection", () => ({
  useConnection: () => ({
    settings: { baseUrl: "https://lc.example", token: "" },
    principal: null,
    signIn: null,
  }),
}));

vi.mock("../lib/buildConnection", () => ({
  buildConnection: (s: { baseUrl: string }) => ({ baseUrl: s.baseUrl }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DocumentsArea", () => {
  it("gives the explorer a stars navigator that gets the explorer's ctx and the app's connection", async () => {
    render(<DocumentsArea onClearTarget={() => {}} />);
    // findBy*: the pane is a lazy chunk behind Suspense.
    const stars = await screen.findByTestId("stars");
    expect(stars.textContent).toBe("tenant/ada/3@https://lc.example");
    expect(screen.queryByText("tree only")).toBeNull();
  });

  it("opens a targeted document in a plain viewer, without a navigator", () => {
    render(<DocumentsArea target={{ documentId: "doc-9", chunkId: "c-1", title: "Nine" }} onClearTarget={() => {}} />);
    expect(screen.getByTestId("viewer")).toBeTruthy();
    expect(screen.queryByTestId("explorer")).toBeNull();
  });
});
