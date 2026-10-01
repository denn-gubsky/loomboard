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

/** A fake client that behaves like loomcycle v1.101.0: listWalkRuns pages
 *  include the walk's own run, but the walk-filtered STREAM applies the real
 *  server filter (`parent_context.walk_id == walkId`) — so the walk's own
 *  transitions never arrive on it (gap G10). An earlier fake sent them, which
 *  is how a live-only bug passed every test. */
function fakeClient(pages: Agent[][][], streams: RunStateEvent[][], walkStatuses: Partial<Agent>[] = []) {
  let hydration = 0;
  let pageIdx = 0;
  let streamIdx = 0;
  let walkIdx = 0;
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
      if (o.walkId && e.parent_context?.walk_id !== o.walkId) continue; // the server's filter
      yield { kind: "event" as const, payload: e };
    }
  });
  const getRun = vi.fn(async (runId: string) =>
    agent({ run_id: runId, ...(walkStatuses[Math.min(walkIdx++, Math.max(0, walkStatuses.length - 1))] ?? {}) }),
  );
  return {
    client: { listWalkRuns, streamUserRunStates, getRun } as unknown as LoomcycleClient,
    listWalkRuns,
    streamUserRunStates,
    getRun,
  };
}

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const member = (o: Partial<RunStateEvent>) => event({ parent_context: { walk_id: WALK, state: "s" }, ...o });

describe("watchWalk", () => {
  it("hydrates every page, then streams this walk's member events", async () => {
    const { client, streamUserRunStates } = fakeClient(
      [[[agent({ run_id: WALK })], [agent({ run_id: "m1", parent_context: { walk_id: WALK, state: "s" } })]]],
      [[member({ run_id: "m1" }), event({ run_id: "stranger" })]],
    );
    const got: WalkRunRow[] = [];
    // Long delays: this case is about ONE hydrate-then-stream cycle.
    const stop = watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, {
      reconnectMs: 10_000,
      pollMs: 10_000,
    });
    await settle();
    stop();
    expect(got.map((r) => r.runId)).toEqual([WALK, "m1", "m1"]);
    expect(streamUserRunStates.mock.calls[0][1]).toMatchObject({ walkId: WALK });
  });

  it("sees the walk END by reading its own run — the filtered stream never carries it (G10)", async () => {
    // The live failure: both members finished, the walk completed 2ms later,
    // and the canvas stayed "Running" because no frame for the walk came.
    const { client, getRun, listWalkRuns } = fakeClient(
      [[[agent({ run_id: WALK })]], [[agent({ run_id: WALK, status: "completed" })]]],
      [[member({ run_id: "m1", status: "completed" }), event({ run_id: WALK, status: "completed" })]],
      [{ status: "completed", completed_at: "2026-10-01T10:02:00Z" }],
    );
    const got: WalkRunRow[] = [];
    watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, {
      reconnectMs: 10_000,
      pollMs: 10_000, // far away: only the member-settled check can see the end in time
    });
    await settle(50);
    expect(getRun).toHaveBeenCalledWith(WALK, expect.anything());
    expect(got.some((r) => r.runId === WALK && r.status === "completed")).toBe(true);
    expect(listWalkRuns).toHaveBeenCalledTimes(2); // initial + final
  });

  it("finds the end by the poll alone when no member event precedes it (e.g. an abort)", async () => {
    const { client, getRun } = fakeClient([[[agent({ run_id: WALK })]]], [[]], [{ status: "cancelled" }]);
    const got: WalkRunRow[] = [];
    watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, { reconnectMs: 10_000, pollMs: 5 });
    await settle(60);
    expect(getRun).toHaveBeenCalled();
    expect(got.some((r) => r.runId === WALK && r.status === "cancelled")).toBe(true);
  });

  it("stops polling once the walk has ended", async () => {
    const { client, getRun } = fakeClient([[[agent({ run_id: WALK })]]], [[]], [{ status: "completed" }]);
    watchWalk(client, async () => "u", WALK, () => undefined, undefined, { reconnectMs: 10_000, pollMs: 5 });
    await settle(60);
    const calls = getRun.mock.calls.length;
    await settle(60);
    expect(getRun.mock.calls.length).toBe(calls);
  });

  it("reports the walk's pause, which also only the walk's own run carries", async () => {
    const { client } = fakeClient([[[agent({ run_id: WALK })]]], [[]], [{ awaited_state: "interrupted" }]);
    const got: WalkRunRow[] = [];
    const stop = watchWalk(client, async () => "u", WALK, (rows) => got.push(...rows), undefined, {
      reconnectMs: 10_000,
      pollMs: 5,
    });
    await settle(40);
    stop();
    expect(got.some((r) => r.runId === WALK && r.awaited === "interrupted")).toBe(true);
  });

  it("never streams a walk the listing already shows ended", async () => {
    const { client, streamUserRunStates } = fakeClient([[[agent({ run_id: WALK, status: "failed" })]]], []);
    watchWalk(client, async () => "u", WALK, () => undefined, undefined, { reconnectMs: 1, pollMs: 10_000 });
    await settle();
    expect(streamUserRunStates).not.toHaveBeenCalled();
  });

  it("reconnects and RE-HYDRATES when the stream ends cleanly", async () => {
    const { client, listWalkRuns, streamUserRunStates } = fakeClient([[[agent({ run_id: WALK })]]], [[], []]);
    const stop = watchWalk(client, async () => "u", WALK, () => undefined, undefined, { reconnectMs: 1, pollMs: 10_000 });
    await settle();
    stop();
    expect(streamUserRunStates.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(listWalkRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports an error without giving up, and stops when told to", async () => {
    const listWalkRuns = vi.fn(async () => {
      throw new Error("503");
    });
    const client = { listWalkRuns, streamUserRunStates: vi.fn(), getRun: vi.fn(async () => agent({ run_id: WALK })) } as unknown as LoomcycleClient;
    const errors: unknown[] = [];
    const stop = watchWalk(client, async () => "u", WALK, () => undefined, (e) => errors.push(e), { reconnectMs: 1, pollMs: 10_000 });
    await settle();
    stop();
    const calls = listWalkRuns.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    await settle();
    expect(listWalkRuns.mock.calls.length).toBe(calls);
  });
});
