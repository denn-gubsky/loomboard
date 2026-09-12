// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "./Inspector";
import { KNOWN_KINDS, fromDefinition, type CanvasNode } from "../lib/model";

afterEach(cleanup);

const nodeOf = (handler: unknown): CanvasNode =>
  fromDefinition({
    entry: "s",
    states: [{ state: "s", handler }],
    transitions: [],
  }).nodes[0];

const noop = () => undefined;

describe("Inspector — the kind picker", () => {
  // This exists because the kind list was duplicated THREE times: KNOWN_KINDS
  // in the model, KIND_OPTIONS in the registry, and a literal in this
  // component. Adding `starter` and `channel` to the first two left the third
  // behind, so the runtime accepted a kind the operator had no way to pick.
  // Deriving the options is the fix; this is what stops it recurring.
  it("offers every kind the model renders, and nothing else", () => {
    render(<Inspector node={nodeOf({ kind: "agent", agent: "a" })} findings={[]} onPatch={noop} onRename={noop} />);
    const options = [...screen.getByRole("combobox").querySelectorAll("option")].map(
      (o) => o.value,
    );
    expect(options).toEqual([...KNOWN_KINDS]);
  });

  it("can switch a state to starter", () => {
    const onPatch = vi.fn();
    render(<Inspector node={nodeOf({ kind: "agent", agent: "a" })} findings={[]} onPatch={onPatch} onRename={noop} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "starter" } });
    expect(onPatch).toHaveBeenCalledWith({ kind: "starter" });
  });
});

describe("Inspector — the team channel ACL", () => {
  const channels = { subscribe: ["inbox"], publish: ["done"] };

  it("shows the team's ACL when no node is selected", () => {
    // The ACL belongs to the workflow, not to any one state, so the otherwise
    // empty pane is the only place it can live.
    render(
      <Inspector
        node={null}
        findings={[]}
        channels={channels}
        onChannelsChange={noop}
        onPatch={noop}
        onRename={noop}
      />,
    );
    expect(screen.getByText(/Team channels/)).toBeTruthy();
    expect((screen.getByLabelText(/Subscribe/) as HTMLTextAreaElement).value).toBe("inbox");
    expect((screen.getByLabelText(/Publish/) as HTMLTextAreaElement).value).toBe("done");
  });

  it("says that editing the ACL forks the definition", () => {
    // Unlike dragging a node, this is content the runtime hashes. An operator
    // who does not know that will be surprised by a new version.
    render(
      <Inspector
        node={null}
        findings={[]}
        channels={channels}
        onChannelsChange={noop}
        onPatch={noop}
        onRename={noop}
      />,
    );
    expect(screen.getByText(/forks the definition/i)).toBeTruthy();
  });

  it("splits a list on newlines and commas, trimming blanks", () => {
    const onChannelsChange = vi.fn();
    render(
      <Inspector
        node={null}
        findings={[]}
        channels={channels}
        onChannelsChange={onChannelsChange}
        onPatch={noop}
        onRename={noop}
      />,
    );
    // fireEvent, not a raw dispatchEvent: React tracks a controlled field's
    // value through a native setter, and a hand-built event bypasses it — the
    // handler never sees the new text and the assertion passes vacuously.
    fireEvent.change(screen.getByLabelText(/Subscribe/), {
      target: { value: "a\n b ,c\n\n" },
    });
    expect(onChannelsChange).toHaveBeenCalledWith({ ...channels, subscribe: ["a", "b", "c"] });
  });

  it("stays out of the way when the host wires no ACL handler", () => {
    render(<Inspector node={null} findings={[]} onPatch={noop} onRename={noop} />);
    expect(screen.queryByText(/Team channels/)).toBeNull();
    expect(screen.getByText(/Select a node/)).toBeTruthy();
  });
});

describe("Inspector — vocabulary (RFC CZ C12)", () => {
  // The word "state" left the canvas when construction became role-based. It
  // survived here in two labels after the palette shipped, which is exactly the
  // kind of half-done rename a guard is for.
  //
  // SCOPE, stated because it is deliberate: this covers the canvas's OWN
  // chrome. Validation findings are exempt — they mirror teamgraph's wording
  // verbatim so the fixture set can drive both validators, and because the
  // server says "state" when it refuses a save. A canvas that said "node"
  // while the runtime said "state" about the same problem would be worse than
  // one that quotes it.
  it("says node, not state, in its own chrome", () => {
    const { container } = render(
      <Inspector node={nodeOf({ kind: "agent", agent: "a" })} findings={[]} onPatch={noop} onRename={noop} />,
    );
    expect(container.textContent).not.toMatch(/\bstate\b/i);
  });

  it("says node in the empty pane too", () => {
    const { container } = render(<Inspector node={null} findings={[]} onPatch={noop} onRename={noop} />);
    expect(container.textContent).not.toMatch(/\bstate\b/i);
  });

  it("still quotes the runtime verbatim in findings", () => {
    // The exemption, asserted so nobody "fixes" it later.
    const { container } = render(
      <Inspector
        node={nodeOf({ kind: "agent", agent: "a" })}
        findings={[{ level: "error", message: 'state "s" handler is missing a `kind`', nodeId: "s" }]}
        onPatch={noop}
        onRename={noop}
      />,
    );
    expect(container.textContent).toContain('state "s"');
  });
});
