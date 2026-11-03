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
const { passthrough, skyView, ctx, chatMounts, viewerMounts, chatConversation } = vi.hoisted(() => {
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
  // How many times the chat mounted: opening a linked document must not remount it.
  const chatMounts = { n: 0 };
  // How many times a document viewer mounted: a second section of the same
  // document must move the open viewer, not replace it.
  const viewerMounts = { n: 0 };
  const chatConversation = { id: "chat-1", title: "", baseAgent: "helper", config: {} };
  return { passthrough, skyView, ctx, chatMounts, viewerMounts, chatConversation };
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
  useConversations: () => ({ conversations: [chatConversation], active: chatConversation, update: vi.fn() }),
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

vi.mock("@loomcycle/explorer", async () => {
  const { useEffect } = await import("react");
  return {
    PathExplorer: (props: ComponentProps<typeof RealPathExplorer>) => (
      <div data-testid="explorer" data-navigator={props.navigator ?? ""} data-scope={props.defaultScope ?? ""}>
        {props.renderNavigator?.(ctx)}
      </div>
    ),
    DocumentViewer: function DocumentViewer(props: { documentId: string; chunkId?: string; scope: string }) {
      useEffect(() => {
        viewerMounts.n += 1;
      }, []);
      return (
        <div data-testid="viewer" data-scope={props.scope} data-chunk={props.chunkId ?? ""}>
          {props.documentId}
        </div>
      );
    },
  };
});
vi.mock("./components/UniverseNavigatorPane", () => ({
  default: ({ initialView }: { initialView?: string }) => <div data-testid="stars">{initialView ?? "none"}</div>,
}));

// The chat: two controls standing in for an agent's links to two sections of
// one document.
vi.mock("./chat/Chat", async () => {
  const { useEffect } = await import("react");
  return {
    default: ({ onOpenDocument }: { onOpenDocument?: (t: import("./chat").DocumentOpenTarget) => void }) => {
      useEffect(() => {
        chatMounts.n += 1;
      }, []);
      return onOpenDocument ? (
        <>
          <button
            type="button"
            onClick={() => onOpenDocument({ documentId: "doc-1", chunkId: "chunk-1", scope: "tenant", title: "Timeline" })}
          >
            Open the linked section
          </button>
          <button
            type="button"
            onClick={() => onOpenDocument({ documentId: "doc-1", chunkId: "chunk-2", scope: "tenant", title: "Risks" })}
          >
            Open another section
          </button>
        </>
      ) : null;
    },
  };
});
// The other areas never render here; stub them so the test does not pay for
// their module graphs.
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
  chatMounts.n = 0;
  viewerMounts.n = 0;
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

describe("App — a document linked in the chat", () => {
  it("opens beside the chat, in the link's scope, without remounting the chat", () => {
    render(<App />);
    expect(chatMounts.n).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Open the linked section" }));

    const panel = screen.getByRole("complementary", { name: "Linked document" });
    expect(panel.textContent).toContain("Timeline");
    const viewer = screen.getByTestId("viewer");
    expect(viewer.textContent).toBe("doc-1");
    expect(viewer.dataset.scope).toBe("tenant");
    expect(viewer.dataset.chunk).toBe("chunk-1");
    expect(screen.getByRole("separator", { name: "Resize the document panel" })).toBeTruthy();
    // The chat is still the one that was streaming.
    expect(chatMounts.n).toBe(1);
  });

  it("moves the open viewer to another section of the same document without remounting it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open the linked section" }));
    fireEvent.click(screen.getByRole("button", { name: "Open another section" }));
    expect(screen.getByTestId("viewer").dataset.chunk).toBe("chunk-2");
    expect(screen.getByRole("complementary").textContent).toContain("Risks");
    expect(viewerMounts.n).toBe(1);
  });

  it("closes, and the chat stays", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open the linked section" }));
    fireEvent.click(screen.getByRole("button", { name: "Close the document" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("button", { name: "Open the linked section" })).toBeTruthy();
    expect(chatMounts.n).toBe(1);
  });

  it("moves to the Documents view on the same document", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open the linked section" }));
    fireEvent.click(screen.getByRole("button", { name: "Open in Documents" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("button", { name: "← All documents" })).toBeTruthy();
    const viewer = screen.getByTestId("viewer");
    expect(viewer.textContent).toBe("doc-1");
    expect(viewer.dataset.chunk).toBe("chunk-1");
  });
});
