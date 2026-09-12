import { describe, expect, it } from "vitest";
import { LoomcycleClient } from "@loomcycle/client";

// A guard over the RFC CZ team-debug contract, pinned to the SDK we ship.
//
// WHY this exists: P5 and P6 — the whole debugger — were blocked for days on a
// client that typed `mode: "detach"` and `run_id` while npm `latest` carried
// neither. The gap was invisible from this repo: everything typechecked against
// the OLD client because nothing used the new calls yet.
//
// So the contract is asserted here rather than discovered when the debugger is
// built. If a future bump removes or renames one of these, this fails with the
// name of the missing call instead of a type error somewhere in the canvas.
//
// These are METHOD-EXISTENCE checks, not behaviour. Behaviour belongs to
// loomcycle's own suite; what this repo needs to know is "can I reach it".

const surface = LoomcycleClient.prototype as unknown as Record<string, unknown>;

describe("RFC CZ team-debug contract — @loomcycle/client", () => {
  it.each([
    // C8: the canvas starts every walk detached, so it has a run_id to address.
    ["runTeam", "start a walk (mode:'detach' returns {run_id, status})"],
    // C6: arm a walk that is ALREADY running — the ad-hoc Run → Debug switch.
    ["setRunBreakpoints", "arm/replace the armed set on a live run"],
    ["getRunBreakpoints", "read back the canonical armed set"],
    // The pause is an Interruption question; these read and answer it.
    ["listRunInterrupts", "read the pause, with each composed prompt"],
    ["resolveInterrupt", "continue | release:<n> | abort"],
    // P1's live miniatures fold this stream.
    ["streamUserRunStates", "live run states"],
  ])("exposes %s — %s", (method) => {
    expect(typeof surface[method]).toBe("function");
  });
});

describe("known gap — watching ONE walk's agents", () => {
  // The runtime supports `GET /v1/users/{id}/agents/stream?walk_id=<run_id>`
  // (loomcycle #1212, internal/api/http/runs_stream.go). The TYPED client does
  // not: #1212 touched no adapters/ts file, and the 1.77.0 bump came from #1207
  // which predates it. So the query param is reachable only by raw fetch today.
  //
  // This test asserts the gap rather than the feature, so it turns red the day
  // a bump closes it — at which point the canvas should switch to the typed
  // call and this block should be deleted, not updated.
  it("streamUserRunStates still cannot filter by walk_id", () => {
    // The options type is erased at runtime, so the check reads the shipped
    // URL builder itself: it sets `status` and `agent`, and nothing else.
    const src = LoomcycleClient.prototype.streamUserRunStates.toString();
    expect(src, "sanity: this is the URL builder we think it is").toContain('"agent"');
    expect(
      src.includes("walk_id"),
      "walk_id is now supported — switch the canvas to the typed option and DELETE this test",
    ).toBe(false);
  });
});
