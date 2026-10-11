import { describe, expect, it, vi } from "vitest";
import type { Agent, LoomcycleClient, RunStateEvent } from "@loomcycle/client";
import type { WalkRunRow } from "@loomboard/workflow";
import { belongsToWalk, rowFromAgent, rowFromEvent } from "./walkRows";
import { watchWalk } from "./walkWatch";

const WALK = "r_walk";

const agent = (o: Partial<Agent>): Agent =>
  ({
    agent_id: "a",
    run_id: "r",
    session_id: "s",
    agent: "x",
    parent_agent_id: null,
    user_id: "u",
    status: "running",
    started_at: "2026-10-01T10:00:00Z",
    completed_at: null,
    stop_reason: null,
    error: null,
    usage: {},
    last_heartbeat_at: null,
    live: true,
    ...o,
  }) as Agent;

const event = (o: Partial<RunStateEvent>): RunStateEvent =>
  ({ run_id: "r", agent_id: "a", agent: "x", user_id: "u", status: "running", ts: "2026-10-01T10:01:00Z", ...o }) as RunStateEvent;

describe("rowFromAgent / rowFromEvent", () => {
  it("carries a member's place in the walk from parent_context (loomcycle 1.101, G3)", () => {
    const r = rowFromAgent(
      agent({
        run_id: "m1",
        parent_context: { walk_id: WALK, state: "review", state_visit: 2, wave_id: "w1", wave_index: 0 },
      }),
    );
    expect(r).toMatchObject({ runId: "m1", state: "review", stateVisit: 2, waveId: "w1", waveIndex: 0 });
  });

  it("does not invent a wave index for a non-Starter member", () => {
    // wave_index has no omitempty on the wire, so 0 appears on every run;
    // it means something only alongside a wave id.
    const r = rowFromAgent(agent({ parent_context: { walk_id: WALK, state: "plan", wave_index: 0 } }));
    expect(r.waveIndex).toBeUndefined();
  });

  it("dates a listing row by its latest known instant", () => {
    expect(rowFromAgent(agent({ completed_at: "2026-10-01T10:09:00Z", status: "completed" })).ts).toBe(
      "2026-10-01T10:09:00Z",
    );
    expect(rowFromAgent(agent({ last_heartbeat_at: "2026-10-01T10:05:00Z" })).ts).toBe("2026-10-01T10:05:00Z");
  });

  it("carries a hold and its deadline from the stream (G1)", () => {
    const r = rowFromEvent(event({ awaited_state: "review", awaited_on: "cite-sources", hold_expires_at: "2026-10-02T00:00:00Z" }));
    expect(r).toMatchObject({ awaited: "review", awaitedOn: "cite-sources", holdExpiresAt: "2026-10-02T00:00:00Z" });
  });

  it("keeps only this walk's events", () => {
    expect(belongsToWalk(event({ run_id: WALK }), WALK)).toBe(true);
    expect(belongsToWalk(event({ parent_context: { walk_id: WALK } }), WALK)).toBe(true);
    expect(belongsToWalk(event({ parent_context: { walk_id: "other" } }), WALK)).toBe(false);
    expect(belongsToWalk(event({}), WALK)).toBe(false);
  });
});

/** A fake client that behaves like loomcycle after #1587 (gap G10 fixed):
 *  listWalkRuns pages include the walk's own run, and the walk-filtered STREAM
 *  applies the server's filter — `run_id == walkId || parent_context.walk_id
 *  == walkId` — so the walk's own start, end and pause arrive on it. It has
 *  NO getRun: the watcher must never need to read the walk's run itself. */
function fakeClient(pages: Agent[][][], streams: RunStateEvent[][], userRuns: Agent[][] = [[]]) {
  // The user's own run listing, where a member's sub-agents are found: one
  // answer per read, the last repeated.
  let userRead = 0;
  const listUserAgents = vi.fn(async (_userId: string) => userRuns[Math.min(userRead++, userRuns.length - 1)]);
  let hydration = 0;
  let pageIdx = 0;
  let streamIdx = 0;
  const listWalkRuns = vi.fn(async (_walkId: string, opts?: { cursor?: string }) => {
    if (!opts?.cursor) {
      pageIdx = 0;
      hydration++;
    }
    const set = pages[Math.min(hydration - 1, pages.length - 1)];
    const agents = set[pageIdx] ?? [];
    pageIdx++;
    return { agents, next_cursor: pageIdx < set.length ? `c${pageIdx}` : "" };
  });
  const streamUserRunStates = vi.fn(async function* (_u: string, o: { walkId?: string }) {
    yield { kind: "open" as const, payload: {} };
    for (const e of streams[streamIdx++] ?? []) {
      if (o.walkId && e.run_id !== o.walkId && e.parent_context?.walk_id !== o.walkId) continue; // the server's filter
      yield { kind: "event" as const, payload: e };
    }
  });
  return {
    client: { listWalkRuns, streamUserRunStates, listUserAgents } as unknown as LoomcycleClient,
    listUserAgents,
    listWalkRuns,
    streamUserRunStates,
  };
}

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const member = (o: Partial<RunStateEvent>) => event({ parent_context: { walk_id: WALK, state: "s" }, ...o });

describe("watchWalk", () => {
  it("hydrates every page, then streams this walk's events", async () => {
    const { client, streamUserRunStates } = fakeClient(
      [[[agent({ run_id: WALK })], [agent({ run_id: "m1", parent_context: { walk_id: WALK, state: "s" } })]]],
      [[member({ run_id: "m1" }), event({ run_id: "stranger" })]],
    );
    const got: WalkRunRow[] = [];
    // A long reconnect: this case is about ONE hydrate-then-stream cycle.
    const stop = watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, { reconnectMs: 10_000 });
    await settle();
    stop();
    expect(got.map((r) => r.runId)).toEqual([WALK, "m1", "m1"]);
    expect(streamUserRunStates.mock.calls[0][1]).toMatchObject({ walkId: WALK });
  });

  it("sees the walk END from its own frame on the stream, folds a last listing and stops (G10 fixed)", async () => {
    const { client, listWalkRuns, streamUserRunStates } = fakeClient(
      [[[agent({ run_id: WALK })]], [[agent({ run_id: WALK, status: "completed" })]]],
      [[member({ run_id: "m1", status: "completed" }), event({ run_id: WALK, status: "completed" })]],
    );
    const got: WalkRunRow[] = [];
    watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, { reconnectMs: 1 });
    await settle(50);
    expect(got.some((r) => r.runId === WALK && r.status === "completed")).toBe(true);
    expect(listWalkRuns).toHaveBeenCalledTimes(2); // initial + final
    expect(streamUserRunStates).toHaveBeenCalledTimes(1); // stopped: no reconnect
  });

  it("reports the walk's breakpoint pause from its own frame", async () => {
    const { client } = fakeClient([[[agent({ run_id: WALK })]]], [[event({ run_id: WALK, awaited_state: "interrupted", awaited_on: "question" })]]);
    const got: WalkRunRow[] = [];
    const stop = watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, { reconnectMs: 10_000 });
    await settle();
    stop();
    expect(got.some((r) => r.runId === WALK && r.awaited === "interrupted")).toBe(true);
  });

  it("never reads the walk's run itself — the stream is enough (the client has no getRun)", async () => {
    const errors: unknown[] = [];
    const { client } = fakeClient(
      [[[agent({ run_id: WALK })]]],
      [[member({ run_id: "m1", status: "completed" })]],
    );
    const stop = watchWalk(client, async () => "u", WALK, () => undefined, (e) => errors.push(e), { reconnectMs: 10_000 });
    await settle(40);
    stop();
    // A getRun call would throw "not a function" and land here.
    expect(errors).toEqual([]);
  });

  it("never streams a walk the listing already shows ended", async () => {
    const { client, streamUserRunStates } = fakeClient([[[agent({ run_id: WALK, status: "failed" })]]], []);
    watchWalk(client, async () => "u", WALK, () => undefined, undefined, { reconnectMs: 1 });
    await settle();
    expect(streamUserRunStates).not.toHaveBeenCalled();
  });

  it("reconnects and RE-HYDRATES when the stream ends cleanly", async () => {
    const { client, listWalkRuns, streamUserRunStates } = fakeClient([[[agent({ run_id: WALK })]]], [[], []]);
    const stop = watchWalk(client, async () => "u", WALK, () => undefined, undefined, { reconnectMs: 1 });
    await settle();
    stop();
    expect(streamUserRunStates.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(listWalkRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports an error without giving up, and stops when told to", async () => {
    const listWalkRuns = vi.fn(async () => {
      throw new Error("503");
    });
    const client = { listWalkRuns, streamUserRunStates: vi.fn() } as unknown as LoomcycleClient;
    const errors: unknown[] = [];
    const stop = watchWalk(client, async () => "u", WALK, () => undefined, (e) => errors.push(e), { reconnectMs: 1 });
    await settle();
    stop();
    const calls = listWalkRuns.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    await settle();
    expect(listWalkRuns.mock.calls.length).toBe(calls);
  });

  // loomcycle 1.110: a run an agent spawns carries its parent run and no walk
  // id, so it is in neither the walk's listing nor its stream.
  const walkPage = [[agent({ run_id: WALK }), agent({ run_id: "m1", parent_run_id: WALK, parent_context: { walk_id: WALK, state: "s" } })]];
  const sub = (o: Partial<Agent>) => agent({ parent_run_id: "m1", agent: "helper", ...o });

  it("finds a member's sub-agents in the user's runs, by the run that started them — at any depth, and no one else's", async () => {
    const { client, listUserAgents } = fakeClient([walkPage], [[]], [
      [sub({ run_id: "c1" }), agent({ run_id: "g1", parent_run_id: "c1" }), agent({ run_id: "x", parent_run_id: "other-run" }), agent({ run_id: "top" })],
    ]);
    const got: WalkRunRow[] = [];
    const stop = watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, { reconnectMs: 10_000 });
    await settle();
    stop();
    expect(got.map((r) => r.runId)).toEqual([WALK, "m1", "c1", "g1"]);
    expect(got.find((r) => r.runId === "c1")).toMatchObject({ parentRunId: "m1", agent: "helper" });
    // Every status: the listing's default is running runs only, and a
    // sub-agent that ended would otherwise never be seen to end.
    expect(listUserAgents).toHaveBeenCalledWith("u", expect.objectContaining({ status: "all" }));
  });

  it("reads the sub-agents again when a member starts waiting for them, and when that wait is over", async () => {
    const { client, listUserAgents } = fakeClient(
      [walkPage],
      [[member({ run_id: "m1", awaited_state: "children", awaited_on: "c1" }), member({ run_id: "m1", ts: "2026-10-01T10:02:00Z" }), member({ run_id: "m1", ts: "2026-10-01T10:03:00Z" })]],
      [[], [sub({ run_id: "c1" })], [sub({ run_id: "c1", status: "completed", completed_at: "2026-10-01T10:01:30Z" })]],
    );
    const got: WalkRunRow[] = [];
    const stop = watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, { reconnectMs: 10_000 });
    await settle();
    stop();
    // Once at hydration, once per change of the wait — not once per frame.
    expect(listUserAgents).toHaveBeenCalledTimes(3);
    expect(got.filter((r) => r.runId === "c1").map((r) => r.status)).toEqual(["running", "completed"]);
  });

  it("keeps following the walk when the user's runs cannot be listed, and says so", async () => {
    const { client, listUserAgents } = fakeClient([walkPage], [[member({ run_id: "m1", status: "completed" })]]);
    listUserAgents.mockRejectedValue(new Error("403"));
    const got: WalkRunRow[] = [];
    const errors: unknown[] = [];
    const stop = watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), (e) => errors.push(e), { reconnectMs: 10_000 });
    await settle();
    stop();
    expect(got.map((r) => r.runId)).toEqual([WALK, "m1", "m1"]);
    expect(String(errors[0])).toMatch(/403/);
  });
});
