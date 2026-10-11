// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { ChannelInfo, ReleaseOutcome, TeamDefDetail, WorkflowDataLayer } from "./types";

// Releasing held messages from a channel's panel (RFC EE item 2): an ordinary
// channel at its declared scope, a team's own channel through the team, and
// the counts read again afterwards.

afterEach(cleanup);

const definition = {
  entry: "intake",
  local: { channels: { journal: { scope: "user", hold: true } } },
  channels: { publish: [], subscribe: ["inbox"] },
  states: [
    { state: "intake", handler: { kind: "starter", source: { channel: "inbox" }, fanout: { agent: "a", per: "message", max: 2 }, sink: { channel: "./journal" } } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [{ from: "intake", to: "done", on: "success" }],
};

function layer(o: Partial<WorkflowDataLayer> = {}) {
  const active: TeamDefDetail = { def_id: "d1", name: "desk", version: 1, definition };
  let inbox = 3;
  let journal = 2;
  const listChannels = vi.fn(async (): Promise<ChannelInfo[]> => [{ name: "inbox", scope: "tenant", hold: true, message_count: inbox, held_count: inbox }]);
  const listTeamChannels = vi.fn(async (_team: string): Promise<ChannelInfo[]> => [{ name: "journal", scope: "user", hold: true, message_count: journal, held_count: journal }]);
  const releaseChannel = vi.fn(async (_channel: string, { count }: { scope: string; count: number }): Promise<ReleaseOutcome> => {
    const released = Math.min(count, inbox);
    inbox -= released;
    return { released, stillHeld: inbox };
  });
  const releaseTeamChannel = vi.fn(async (_team: string, _name: string, { count }: { count: number }): Promise<ReleaseOutcome> => {
    const released = Math.min(count, journal);
    journal -= released;
    return { released, stillHeld: journal };
  });
  const l: WorkflowDataLayer = {
    listTeams: async () => [{ name: "desk", active_def_id: "d1" }],
    getActiveTeamDef: async () => active,
    getTeamDef: async () => active,
    createTeam: async () => ({ def_id: "dx", name: "desk", version: 1 }),
    forkTeam: async () => ({ def_id: "d2", name: "desk", version: 2 }),
    listChannels,
    listTeamChannels,
    releaseChannel,
    releaseTeamChannel,
    ...o,
  };
  return { l, listChannels, listTeamChannels, releaseChannel, releaseTeamChannel };
}

async function open(l: WorkflowDataLayer, channel: string) {
  render(<WorkflowCanvas dataLayer={l} teamName="desk" />);
  fireEvent.click(await screen.findByTestId(`channel-${channel}`));
  // The panel's Stored row comes with the channel's listing.
  await screen.findByText("Stored");
}

describe("WorkflowCanvas — releasing held messages", () => {
  it("releases one message of a channel at its declared scope, and reads the counts again", async () => {
    const { l, listChannels, releaseChannel, releaseTeamChannel } = layer();
    await open(l, "inbox");
    const before = listChannels.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Release 1" }));
    expect(await screen.findByText("Delivered 1 message; 2 still held.")).toBeTruthy();
    expect(releaseChannel).toHaveBeenCalledWith("inbox", { scope: "tenant", count: 1 });
    expect(releaseTeamChannel).not.toHaveBeenCalled();
    await waitFor(() => expect(listChannels.mock.calls.length).toBeGreaterThan(before));
    // The panel now offers what is left.
    expect(await screen.findByRole("button", { name: "Release all 2" })).toBeTruthy();
  });

  it("releases all of a team's own channel through the team, by its local name", async () => {
    const { l, listTeamChannels, releaseChannel, releaseTeamChannel } = layer();
    await open(l, "./journal");
    const before = listTeamChannels.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Release all 2" }));
    expect(await screen.findByText("Delivered 2 messages; 0 still held.")).toBeTruthy();
    expect(releaseTeamChannel).toHaveBeenCalledWith("desk", "journal", { count: 2 });
    expect(releaseChannel).not.toHaveBeenCalled();
    await waitFor(() => expect(listTeamChannels.mock.calls.length).toBeGreaterThan(before));
    // Nothing held any more: the action goes.
    await waitFor(() => expect(screen.queryByTestId("channel-release")).toBeNull());
  });

  it("shows the runtime's refusal, and still reads the counts again", async () => {
    const { l, listChannels } = layer({ releaseChannel: vi.fn(async () => Promise.reject(new Error("403 channel_forbidden"))) });
    await open(l, "inbox");
    const before = listChannels.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Release 1" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not released: 403 channel_forbidden");
    await waitFor(() => expect(listChannels.mock.calls.length).toBeGreaterThan(before));
  });

  it("reads the counts again when a walk ends, since what it published is what there is to release", async () => {
    const { l, listChannels } = layer({
      runTeamDetached: async () => ({ run_id: "r_walk", status: "running" }),
      watchWalk: (walkRunId, onRows) => {
        onRows([{ runId: walkRunId, agentId: "a_walk", agent: "team:desk", status: "completed", ts: "2026-10-11T10:00:00Z" }]);
        return () => undefined;
      },
    });
    await open(l, "inbox");
    const before = listChannels.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByTestId("walk-id");
    await waitFor(() => expect(listChannels.mock.calls.length).toBeGreaterThan(before));
  });

  it("offers no release on a host that cannot release", async () => {
    const { l } = layer({ releaseChannel: undefined, releaseTeamChannel: undefined });
    await open(l, "inbox");
    expect(screen.queryByTestId("channel-release")).toBeNull();
  });
});
