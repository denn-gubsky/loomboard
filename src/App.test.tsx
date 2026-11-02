// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import type { ComponentProps } from "react";
import type { PathExplorer as RealPathExplorer } from "@loomcycle/explorer";
import type { BoardScope, SavedView } from "@loomcycle/loomboard";
import type { SidebarView } from "./components/Sidebar";
import App from "./App";

// The Boards → star map hand-off: a view saved from the star map is listed by
// Boards; "Open in the star map" must land in Documents with the explorer on
// its stars navigator, in the view's scope, and the view id reaching the map.
// Everything around that path is stubbed; the rail is two buttons.

// vi.mock factories hoist above every statement, so what they share is hoisted too.
const { passthrough, skyView, ctx } = vi.hoisted(() => {
  const passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  // Boards' one universe view.
  const skyView = {
    documentId: "view-7",
    rootChunkId: "root-7",
    title: "Sky",
    query: {},
    layout: { kind: "universe" },
  } as unknown as import("@loomcycle/loomboard").SavedView;
  const ctx: import("@loomcycle/explorer").NavigatorContext = {
    scope: "user",
    selection: {},
    onSelect: () => {},
    reloadToken: 0,
    maximized: false,
    onToggleMaximize: () => {},
  };
  return { passthrough, skyView, ctx };
});

vi.mock("./state/connection", () => ({
  ConnectionProvider: passthrough,
  useConnection: () => ({
    status: "connected",
    settings: { baseUrl: "https://lc.example", token: "" },
    signIn: null,
    principal: null,
    // Every gated view reachable.
    capabilities: { views: new Proxy({}, { get: () => true }), isAdmin: false, isIsolated: false },
  }),
}));
vi.mock("./state/conversations", () => ({
  ConversationsProvider: passthrough,
  useConversations: () => ({ conversations: [], active: undefined, update: vi.fn() }),
}));
vi.mock("./state/activeChat", () => ({
  ActiveChatProvider: passthrough,
  useActiveChat: () => ({ setStatus: vi.fn(), recap: null }),
}));
vi.mock("./lib/buildConnection", () => ({
  buildConnection: (s: { baseUrl: string }) => ({ baseUrl: s.baseUrl }),
}));
vi.mock("./components/Sidebar", () => ({
  default: ({ onViewChange }: { onViewChange: (v: SidebarView) => void }) => (
    <nav>
      <button type="button" onClick={() => onViewChange("boards")}>
        Boards
      </button>
      <button type="button" onClick={() => onViewChange("documents")}>
        Documents
      </button>
    </nav>
  ),
}));

// Boards shows the button only when the host supplies onOpenUniverse.
vi.mock("@loomcycle/loomboard", () => ({
  Loomboard: ({ onOpenUniverse }: { onOpenUniverse?: (view: SavedView, scope: BoardScope) => void }) =>
    onOpenUniverse ? (
      <button type="button" onClick={() => onOpenUniverse(skyView, "tenant")}>
        Open in the star map
      </button>
    ) : (
      <p>Open this view in the star map from Documents.</p>
    ),
}));

vi.mock("@loomcycle/explorer", () => ({
  PathExplorer: (props: ComponentProps<typeof RealPathExplorer>) => (
    <div data-testid="explorer" data-navigator={props.navigator ?? ""} data-scope={props.defaultScope ?? ""}>
      {props.renderNavigator?.(ctx)}
    </div>
  ),
  DocumentViewer: () => null,
}));
vi.mock("./components/UniverseNavigatorPane", () => ({
  default: ({ initialView }: { initialView?: string }) => <div data-testid="stars">{initialView ?? "none"}</div>,
}));

// The other areas and the chat never render here; stub them so the test does
// not pay for their module graphs.
vi.mock("./chat/Chat", () => ({ default: () => null }));
vi.mock("@loomcycle/library", () => ({ Library: () => null }));
vi.mock("@loomcycle/memory-view", () => ({ MemoryView: () => null }));
vi.mock("./components/agentchat/AgentPortfolioGrid", () => ({ default: () => null }));
vi.mock("./components/workflow/WorkflowArea", () => ({ default: () => null }));
vi.mock("./components/workflow/CanvasArea", () => ({ default: () => null }));
vi.mock("./components/PendingApprovals", () => ({ default: () => null }));
vi.mock("./components/MyAccess", () => ({ default: () => null }));
vi.mock("./components/AppClients", () => ({ default: () => null }));
vi.mock("./components/ConnectionSettings", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("opens a Boards star-map view in Documents on the stars navigator, in the view's scope, with the view id", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Boards" }));
    fireEvent.click(screen.getByRole("button", { name: "Open in the star map" }));

    const explorer = screen.getByTestId("explorer");
    expect(explorer.dataset.navigator).toBe("stars");
    expect(explorer.dataset.scope).toBe("tenant");
    expect((await screen.findByTestId("stars")).textContent).toBe("view-7");
  });

  it("drops the saved view when the rail picks Documents afresh", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Boards" }));
    fireEvent.click(screen.getByRole("button", { name: "Open in the star map" }));
    await screen.findByTestId("stars");

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.getByTestId("explorer").dataset.navigator).toBe("");
    expect((await screen.findByTestId("stars")).textContent).toBe("none");
  });
});
