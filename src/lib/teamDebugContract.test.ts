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
    // The before_dispatch pause is an Interruption question; these read and
    // answer it. Since RFC DJ removed after_collection, release:<n> counts
    // dispatches only. A code-js hook's ask is answered the same way.
    ["listRunInterrupts", "read the pause, with each composed prompt"],
    ["resolveInterrupt", "continue | release:<n> | abort — before_dispatch only"],
    // P1's live miniatures fold this stream.
    ["streamUserRunStates", "live run states"],
    // C16: a walk's run has no turns, so this ENDS it (loomcycle #1341).
    ["cancelTurn", "stop a live walk by its run id"],
    // C13: a member run is read from the Run itself (RFC DI).
    ["getAgent", "a run's result and spec"],
    // G5 (loomcycle 1.101): a run by its RUN id — the only way to read a walk's
    // own run, whose agent id `team:<name>` is shared by every walk of a team.
    ["getRun", "one run by run id, including a walk's"],
    // G4 (loomcycle 1.101): one walk's runs, paged — reloading a finished walk.
    ["listWalkRuns", "the walk's own run and every member, oldest first"],
    ["getRunPrompt", "the exact prompt a run was sent"],
    // C14: the verdict on a member held for review (RFC DJ).
    ["reviewRun", "approve | reject with feedback | reject"],
    // C15: HookDef names for the hooks editor (RFC DK).
    ["hookDef", "HookDef substrate operations"],
  ])("exposes %s — %s", (method) => {
    expect(typeof surface[method]).toBe("function");
  });
});

// The "known gap — watching ONE walk's agents" block that used to live here is
// gone, exactly as it asked to be: it asserted that the TYPED client could not
// filter streamUserRunStates by walk_id, so that it would turn red the day a
// bump closed the gap. @loomcycle/client 1.78.0 added the `walkId` option and
// the 1.82.0 bump brought it in, so the gap is closed and the assertion was
// deleted rather than updated, per its own instruction.
//
// Nothing in the canvas filtered by walk yet — there was no raw-fetch
// workaround to migrate — so adopting `streamUserRunStates(userId, { walkId })`
// is now available, unblocked, and still to do.
