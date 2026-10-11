// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunChatColumn } from "./RunChatColumn";
import type { WalkRunRow } from "./lib/runs";

afterEach(cleanup);

const row = (o: Partial<WalkRunRow> & { runId: string }): WalkRunRow => ({
  agentId: "a",
  agent: "lead",
  status: "completed",
  ts: "2026-10-01T10:00:00Z",
  ...o,
});

describe("RunChatColumn — a run with sub-agents", () => {
  const rows = [row({ runId: "m1", parentRunId: "r_walk" }), row({ runId: "c1", parentRunId: "m1", agent: "helper", status: "running" })];
  const chat = (r: { runId: string }) => <div data-testid="chat">{r.runId}</div>;

  it("opens on the state's own run, not on a sub-agent that is still going", () => {
    render(<RunChatColumn state="lead" rows={rows} renderRunChat={chat} onDetails={() => undefined} />);
    expect(screen.getByTestId("chat").textContent).toBe("m1");
  });

  it("offers each sub-agent in the picker by its agent, and opens its conversation", () => {
    render(<RunChatColumn state="lead" rows={rows} renderRunChat={chat} onDetails={() => undefined} />);
    const picker = screen.getByRole("combobox", { name: "Run" });
    expect([...picker.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["#1 · completed", "↳ helper · running"]);
    fireEvent.change(picker, { target: { value: "c1" } });
    expect(screen.getByTestId("chat").textContent).toBe("c1");
  });
});
