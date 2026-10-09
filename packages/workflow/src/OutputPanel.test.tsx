// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputPanel } from "./OutputPanel";
import type { ChannelNodeView } from "./lib/channelNodes";
import type { ChannelMessage } from "./lib/output";

afterEach(cleanup);

const view = (o: Partial<ChannelNodeView>): ChannelNodeView => ({
  id: "channel:out",
  channel: "out",
  publishers: ["edit"],
  readers: [],
  position: { x: 0, y: 0 },
  placed: false,
  wired: true,
  grants: {},
  ...o,
});

describe("OutputPanel", () => {
  it("peeks each output channel at its DECLARED scope and shows the answers", async () => {
    const peek = vi.fn(async (): Promise<ChannelMessage[]> => [
      { id: "m1", publishedAt: "2026-10-01T10:00:00Z", value: { status: "ok", run_id: "r9", output: "article_chunk_42" } },
    ]);
    const channels = [view({ info: { name: "out", scope: "tenant" }, declared: true })];
    render(<OutputPanel channels={channels} peekChannel={peek} />);
    expect(await screen.findByText("article_chunk_42")).toBeTruthy();
    expect(peek).toHaveBeenCalledWith("out", expect.objectContaining({ scope: "tenant" }));
    expect(screen.getByText(/ok · r9/)).toBeTruthy();
  });

  it("does not guess a scope — an unlisted channel is reported, not peeked", async () => {
    const peek = vi.fn(async (): Promise<ChannelMessage[]> => []);
    render(<OutputPanel channels={[view({ declared: false })]} peekChannel={peek} />);
    expect(await screen.findByText(/not declared on this runtime/)).toBeTruthy();
    expect(peek).not.toHaveBeenCalled();
  });

  it("lists one of the team's own channels without peeking it, and says why it cannot be read here", async () => {
    // Regression: it was reported as "scope unknown — channel list not loaded", an
    // error about a listing the runtime never puts a team's own channel in.
    const peek = vi.fn(async (): Promise<ChannelMessage[]> => [{ id: "m1", publishedAt: "2026-10-08T10:00:00Z", value: "hi" }]);
    render(
      <OutputPanel
        channels={[view({ id: "channel:./journal", channel: "./journal", declared: true }), view({ info: { name: "out", scope: "tenant" } })]}
        peekChannel={peek}
      />,
    );
    await waitFor(() => expect(peek).toHaveBeenCalledTimes(1));
    expect(peek).toHaveBeenCalledWith("out", { scope: "tenant", max: 50 });
    const own = screen.getByTestId("output-./journal");
    expect(own.textContent).toMatch(/The team's own channel\. Only this team's walks and its own agents can read it/);
    expect(own.textContent).not.toMatch(/scope unknown|not declared/);
    expect(own.querySelector(".lb-wf-finding--error")).toBeNull();
  });

  it("reads one of the team's own channels through the team, by its local name", async () => {
    const peek = vi.fn(async (): Promise<ChannelMessage[]> => []);
    const peekTeam = vi.fn(async (): Promise<ChannelMessage[]> => [{ id: "m1", publishedAt: "2026-10-09T10:00:00Z", value: "noted" }]);
    render(
      <OutputPanel
        channels={[view({ id: "channel:./journal", channel: "./journal", declared: true, info: { name: "journal", scope: "user", message_count: 1 } })]}
        peekChannel={peek}
        peekTeamChannel={peekTeam}
      />,
    );
    expect(await screen.findByText("noted")).toBeTruthy();
    expect(peekTeam).toHaveBeenCalledWith("journal", { max: 50 });
    // Never by its name: the runtime refuses that.
    expect(peek).not.toHaveBeenCalled();
    expect(screen.getByTestId("output-./journal").textContent).toMatch(/user · the team's own/);
  });

  it("says a channel only the draft declares is not in the saved team yet, without asking the runtime", async () => {
    const peekTeam = vi.fn(async (): Promise<ChannelMessage[]> => []);
    render(
      <OutputPanel
        channels={[view({ id: "channel:./fresh", channel: "./fresh", declared: true })]}
        peekChannel={vi.fn(async () => [])}
        peekTeamChannel={peekTeam}
        teamChannelsListed
      />,
    );
    expect(await screen.findByText(/The saved team does not declare it yet: save the team/)).toBeTruthy();
    expect(peekTeam).not.toHaveBeenCalled();
  });

  it("does not claim that when the team's channels could not be listed — it asks, and shows the answer", async () => {
    // Regression: a failed listing left every own channel reading "not in the saved team yet".
    const peekTeam = vi.fn(async (): Promise<ChannelMessage[]> => [{ id: "m1", publishedAt: "2026-10-09T10:00:00Z", value: "still readable" }]);
    render(
      <OutputPanel
        channels={[view({ id: "channel:./journal", channel: "./journal", declared: true })]}
        peekChannel={vi.fn(async () => [])}
        peekTeamChannel={peekTeam}
      />,
    );
    expect(await screen.findByText("still readable")).toBeTruthy();
    expect(screen.queryByText(/does not declare it yet/)).toBeNull();
  });

  it("shows why one of the team's own channels could not be read", async () => {
    render(
      <OutputPanel
        channels={[view({ id: "channel:./journal", channel: "./journal", declared: true, info: { name: "journal", scope: "user" } })]}
        peekChannel={vi.fn(async () => [])}
        peekTeamChannel={vi.fn(async () => Promise.reject(new Error("403 insufficient_scope")))}
      />,
    );
    expect(await screen.findByText("403 insufficient_scope")).toBeTruthy();
  });

  it("re-peeks when the refresh key changes — a run settled", async () => {
    const peek = vi.fn(async (): Promise<ChannelMessage[]> => []);
    const channels = [view({ info: { name: "out", scope: "tenant" }, declared: true })];
    const { rerender } = render(<OutputPanel channels={channels} peekChannel={peek} refreshKey="a" />);
    await waitFor(() => expect(peek).toHaveBeenCalledTimes(1));
    rerender(<OutputPanel channels={channels} peekChannel={peek} refreshKey="b" />);
    await waitFor(() => expect(peek).toHaveBeenCalledTimes(2));
  });

  it("renders nothing when the team has no output channel", () => {
    const { container } = render(<OutputPanel channels={[]} peekChannel={async () => []} />);
    expect(container.firstChild).toBeNull();
  });
});
