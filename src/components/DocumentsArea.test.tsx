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
    <div data-testid="explorer" data-navigator={props.navigator ?? ""} data-scope={props.defaultScope ?? ""}>
      {props.renderNavigator ? props.renderNavigator(ctx) : "tree only"}
    </div>
  ),
  DocumentViewer: () => <div data-testid="viewer" />,
}));

vi.mock("./UniverseNavigatorPane", () => ({
  default: ({
    ctx,
    connection,
    initialView,
  }: {
    ctx: NavigatorContext;
    connection: { baseUrl: string };
    initialView?: string;
  }) => (
    <div data-testid="stars" data-initial-view={initialView ?? ""}>
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
    // No saved view asked for: the explorer keeps its own navigator choice
    // and scope, and the map opens on nothing in particular.
    expect(screen.getByTestId("explorer").dataset.navigator).toBe("");
    expect(screen.getByTestId("explorer").dataset.scope).toBe("");
    expect(stars.dataset.initialView).toBe("");
  });

  it("opens a saved star-map view on the stars navigator, in its scope, and hands the map the view id", async () => {
    render(<DocumentsArea starView={{ viewId: "view-7", scope: "tenant" }} onClearTarget={() => {}} />);
    const stars = await screen.findByTestId("stars");
    expect(screen.getByTestId("explorer").dataset.navigator).toBe("stars");
    expect(screen.getByTestId("explorer").dataset.scope).toBe("tenant");
    expect(stars.dataset.initialView).toBe("view-7");
  });

  it("opens a targeted document in a plain viewer, without a navigator", () => {
    render(<DocumentsArea target={{ documentId: "doc-9", chunkId: "c-1", title: "Nine" }} onClearTarget={() => {}} />);
    expect(screen.getByTestId("viewer")).toBeTruthy();
    expect(screen.queryByTestId("explorer")).toBeNull();
  });
});
