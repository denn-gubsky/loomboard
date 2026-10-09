// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { ChannelMessage } from "./lib/output";
import type { ChannelInfo, TeamDefDetail, WorkflowDataLayer } from "./types";

// A team's own channel (`./name`) is read through the team (loomcycle 1.108,
// gap G22): its messages in the Output panel, never by the channel's name.

afterEach(cleanup);

const definition = {
  entry: "write",
  local: { channels: { journal: { scope: "user" } } },
  states: [
    { state: "write", handler: { kind: "agent", agent: "writer" } },
    { state: "note", handler: { kind: "channel", channel: "./journal" } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "write", to: "note", on: "success" },
    { from: "note", to: "done", on: "success" },
  ],
};

function layer(o: Partial<WorkflowDataLayer> = {}) {
  const active: TeamDefDetail = { def_id: "d1", name: "blog", version: 1, definition };
  const peekChannel = vi.fn(async (): Promise<ChannelMessage[]> => []);
  const listTeamChannels = vi.fn(async (_team: string): Promise<ChannelInfo[]> => [{ name: "journal", scope: "user", message_count: 1 }]);
  const peekTeamChannel = vi.fn(
    async (_team: string, _name: string, _o: { max?: number }): Promise<ChannelMessage[]> => [
      { id: "m1", publishedAt: "2026-10-09T10:00:00Z", value: "SSDs are fast." },
    ],
  );
  const l: WorkflowDataLayer = {
    listTeams: async () => [{ name: "blog", active_def_id: "d1" }],
    getActiveTeamDef: async () => active,
    getTeamDef: async () => active,
    createTeam: async () => ({ def_id: "dx", name: "blog", version: 1 }),
    forkTeam: async () => ({ def_id: "d2", name: "blog", version: 2 }),
    listChannels: async () => [],
    peekChannel,
    listTeamChannels,
    peekTeamChannel,
    ...o,
  };
  return { l, peekChannel, listTeamChannels, peekTeamChannel };
}

describe("WorkflowCanvas — a team's own channel (G22)", () => {
  it("shows what the team published to its own channel, read through the team", async () => {
    const { l, peekChannel, listTeamChannels, peekTeamChannel } = layer();
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    expect(await screen.findByText("SSDs are fast.")).toBeTruthy();
    expect(listTeamChannels).toHaveBeenCalledWith("blog");
    expect(peekTeamChannel).toHaveBeenCalledWith("blog", "journal", { max: 50 });
    expect(peekChannel).not.toHaveBeenCalled();
  });

  it("says the channel cannot be read on a host that has no way to", async () => {
    const { l, peekChannel } = layer({ listTeamChannels: undefined, peekTeamChannel: undefined });
    render(<WorkflowCanvas dataLayer={l} teamName="blog" />);
    const row = await screen.findByTestId("output-./journal");
    await waitFor(() => expect(row.textContent).toMatch(/Only this team's walks and its own agents can read it/));
    expect(peekChannel).not.toHaveBeenCalled();
  });
});
