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

  it("shows the team's ACL when no state is selected", () => {
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
    expect(screen.getByText(/Select a state/)).toBeTruthy();
  });
});
