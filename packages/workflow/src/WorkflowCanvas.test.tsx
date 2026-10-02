// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { TeamDefDetail, WorkflowDataLayer } from "./types";
import type { WalkRunRow } from "./lib/runs";

// Render smoke tests.
//
// The pure tests prove the model round-trips and the mirror agrees with the
// runtime; neither proves the thing MOUNTS. These cover the paths where a
// silent failure would be worst: an opaque node (the whole point of the
// passthrough design) rendering as something an operator can see and
// understand, and a definition the canvas half-understands still drawing
// rather than throwing.

const definition = {
  entry: "code",
  states: [
    { state: "code", handler: { kind: "agent", agent: "coder" } },
    {
      state: "review",
      handler: { kind: "parallel", agents: ["sec", "qa"], wait: "at_least:2", consolidator: "judge" },
    },
    // A kind this build has never heard of (fictional on purpose — see model.test.ts).
    { state: "ship", handler: { kind: "from-a-newer-runtime", source: { channel: "pr-events" } } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "code", to: "review", on: "success" },
    { from: "review", to: "ship", on: "success" },
    { from: "review", to: "code", on: "pushback:redo" },
    { from: "ship", to: "done", on: "success" },
  ],
};

function stubLayer(overrides: Partial<WorkflowDataLayer> = {}): WorkflowDataLayer {
  const detail: TeamDefDetail = { def_id: "def-1", name: "sdlc", version: 3, definition };
  return {
    listTeams: async () => [{ name: "sdlc", active_def_id: "def-1" }],
    getActiveTeamDef: async () => detail,
    getTeamDef: async () => detail,
    createTeam: async () => ({ def_id: "def-2", name: "sdlc", version: 4 }),
    forkTeam: async () => ({ def_id: "def-2", name: "sdlc", version: 4 }),
    ...overrides,
  };
}

// Without `globals: true`, @testing-library/react registers no automatic
// cleanup — every render would pile into the same document.body and the
// second test onwards would match multiple nodes.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkflowCanvas", () => {
  it("mounts and draws a node per state", async () => {
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    for (const id of ["code", "review", "ship", "done"]) {
      expect(await screen.findByTestId(`node-${id}`)).toBeTruthy();
    }
  });

  it("renders an unknown handler kind as an opaque node that explains itself", async () => {
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    const ship = await screen.findByTestId("node-ship");
    // The kind is shown verbatim — an operator has to be able to tell WHICH
    // kind this build does not know.
    expect(ship.textContent).toContain("from-a-newer-runtime");
    expect(ship.className).toContain("lb-wf-node--opaque");
    expect(ship.textContent).toMatch(/not known to this canvas version/i);
  });

  it("does not report an unknown kind as a problem", async () => {
    // RFC CZ decision 3: an older canvas talking to a newer runtime must not
    // paint a valid graph red.
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    await screen.findByTestId("node-ship");
    expect(screen.queryByText(/\d+ problems?/)).toBeNull();
  });

  it("marks the entry state", async () => {
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    const code = await screen.findByTestId("node-code");
    expect(code.textContent).toContain("entry");
  });

  it("shows the agents and the parallel wait policy on the node face", async () => {
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    const review = await screen.findByTestId("node-review");
    expect(review.textContent).toContain("sec");
    expect(review.textContent).toContain("qa");
    expect(review.textContent).toContain("at_least:2");
  });

  it("surfaces a load failure instead of rendering an empty canvas", async () => {
    render(
      <WorkflowCanvas
        dataLayer={stubLayer({
          getActiveTeamDef: async () => {
            throw new Error("no active version");
          },
        })}
        teamName="sdlc"
      />,
    );
    expect(await screen.findByText(/Failed to load: no active version/)).toBeTruthy();
  });

  it("still draws a graph the validator rejects, so the operator can fix it", async () => {
    // An unreachable state is an error, but refusing to render would leave
    // nothing to correct.
    const broken = {
      entry: "a",
      states: [
        { state: "a", handler: { kind: "agent", agent: "x" } },
        { state: "orphan", handler: { kind: "terminal" } },
      ],
      transitions: [],
    };
    render(
      <WorkflowCanvas
        dataLayer={stubLayer({
          getActiveTeamDef: async () => ({
            def_id: "d",
            name: "broken",
            version: 1,
            definition: broken,
          }),
        })}
        teamName="broken"
      />,
    );
    expect(await screen.findByTestId("node-orphan")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/problems?$/)).toBeTruthy());
  });

  it("hides editing affordances in readonly mode", async () => {
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" mode="readonly" />);
    await screen.findByTestId("node-code");
    expect(screen.queryByText("Save new version")).toBeNull();
    // The palette, not "Add state" — asserting the absence of a control that
    // no longer exists anywhere would pass for the wrong reason.
    expect(screen.queryByLabelText("Node palette")).toBeNull();
  });
});

describe("WorkflowCanvas — the Starter (RFC CZ P4)", () => {
  const starterDef = {
    entry: "intake",
    // The team ACL, without which create/fork refuses this definition outright
    // — a Starter resolves its channels under the TEAM's authority. The fixture
    // lacked it until aclFindings started checking, which means it described a
    // graph the runtime would never have accepted.
    channels: {
      subscribe: ["sdlc-intake", "sdlc-plans"],
      publish: ["sdlc-plans", "sdlc-done"],
    },
    states: [
      {
        state: "intake",
        handler: {
          kind: "starter",
          source: { channel: "sdlc-intake" },
          fanout: { agent: "architect", per: "message", max: 8 },
          sink: { channel: "sdlc-plans" },
        },
      },
      {
        state: "plan",
        handler: {
          kind: "starter",
          source: { channel: "sdlc-plans" },
          fanout: { agent: "coder", per: "once" },
        },
      },
      { state: "announce", handler: { kind: "channel", channel: "sdlc-done" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "intake", to: "plan", on: "success" },
      { from: "plan", to: "announce", on: "success" },
      { from: "announce", to: "done", on: "success" },
    ],
  };

  const layer = () =>
    stubLayer({
      getActiveTeamDef: async () => ({
        def_id: "def-s",
        name: "sdlc",
        version: 1,
        definition: starterDef,
      }),
    });

  it("draws each channel the team names as a node of its own", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    for (const ch of ["sdlc-intake", "sdlc-plans", "sdlc-done"]) {
      expect(await screen.findByTestId(`channel-${ch}`)).toBeTruthy();
    }
    // sdlc-plans: intake publishes, plan reads.
    expect(screen.getByTestId("channel-sdlc-plans").textContent).toMatch(/1 → 1/);
  });

  it("marks a channel the runtime has not declared, once the list has loaded", async () => {
    render(
      <WorkflowCanvas
        dataLayer={stubLayer({
          ...layer(),
          listChannels: async () => [
            { name: "sdlc-intake", scope: "tenant" },
            { name: "sdlc-plans", scope: "tenant", hold: true, hooks: ["moderate"] },
          ],
        })}
        teamName="sdlc"
      />,
    );
    const done = await screen.findByTestId("channel-sdlc-done");
    await waitFor(() => expect(done.textContent).toMatch(/not declared/));
    const plans = screen.getByTestId("channel-sdlc-plans");
    expect(plans.textContent).toMatch(/HELD/);
    expect(plans.textContent).toMatch(/1 hook gate every message/);
  });

  it("shows a selected channel's details in the inspector, read-only", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    fireEvent.click(await screen.findByTestId("channel-sdlc-plans"));
    const panel = (await screen.findByText(/Referenced, not owned/)).closest("aside")!;
    expect(panel.textContent).toMatch(/Publishers\s*intake/);
    expect(panel.textContent).toMatch(/Readers\s*plan/);
  });

  it("places a channel from the palette as an unwired reference", async () => {
    render(
      <WorkflowCanvas
        dataLayer={stubLayer({ ...layer(), listChannels: async () => [{ name: "results", scope: "tenant" }] })}
        teamName="sdlc"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Channel/ }));
    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "results" } });
    fireEvent.click(screen.getByRole("button", { name: "Place" }));
    const node = await screen.findByTestId("channel-results");
    expect(node.textContent).toMatch(/not wired yet/);
    // Placing adds no state: a reference is layout, not content.
    expect(screen.queryByTestId("node-results")).toBeNull();
  });

  it("grants a missing ACL side from the channel panel, clearing the finding", async () => {
    const noAcl = { ...starterDef, channels: { subscribe: ["sdlc-intake", "sdlc-plans"], publish: ["sdlc-done"] } };
    render(
      <WorkflowCanvas
        dataLayer={stubLayer({
          getActiveTeamDef: async () => ({ def_id: "d", name: "sdlc", version: 1, definition: noAcl }),
        })}
        teamName="sdlc"
      />,
    );
    // intake publishes to sdlc-plans, which the ACL does not grant.
    await screen.findByText(/uses channel "sdlc-plans" as its sink/);
    fireEvent.click(await screen.findByTestId("channel-sdlc-plans"));
    fireEvent.click(await screen.findByRole("button", { name: /Grant publish in Team channels/ }));
    await waitFor(() => expect(screen.queryByText(/uses channel "sdlc-plans" as its sink/)).toBeNull());
  });

  it("draws a Starter IN the data row: its channel before it, its agent after it, the rule on its face", async () => {
    // C2 amended: the pipeline is channel → Starter → agent → channel, so what
    // the Starter reads and dispatches are nodes of their own beside it.
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    const intake = await screen.findByTestId("node-intake");
    expect(intake.className).toContain("lb-wf-node--starter");
    expect(intake.className).not.toContain("lb-wf-node--opaque");
    expect(intake.textContent).toContain("one run per message · max 8");
    expect(intake.textContent).not.toContain("architect");
    expect((await screen.findByTestId("agent-intake")).textContent).toContain("architect");
    expect(screen.getByTestId("channel-sdlc-intake")).toBeTruthy();
    expect(screen.getByTestId("channel-sdlc-plans")).toBeTruthy();
  });

  it("reads a Starter's agents from fanout, not from the handler's top level", async () => {
    // The runtime refuses a top-level `agent` on a starter, so `fanout.agent`
    // is the only place the name can legitimately live.
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    expect((await screen.findByTestId("agent-plan")).textContent).toContain("coder");
  });

  it("renders a publish-only channel node as an action, not an agent", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    const announce = await screen.findByTestId("node-announce");
    expect(announce.className).toContain("lb-wf-node--channel");
    expect(announce.textContent).toContain("sdlc-done");
    // "publish" names the action; the kind name alone would read as though this
    // node and a Starter were the same sort of thing.
    expect(announce.textContent).toContain("publish");
  });

  it("does not flag a valid Starter graph as a problem", async () => {
    // The whole point of teaching the mirror validateStarter: a definition the
    // runtime accepts must not come up red.
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    await screen.findByTestId("node-intake");
    expect(screen.queryByText(/\d+ problems?/)).toBeNull();
  });

  it("flags a Starter the runtime would refuse", async () => {
    // per=message with no ceiling — the spawn-amplifier rule. Caught while
    // drawing rather than at op=create.
    const bad = structuredClone(starterDef);
    delete (bad.states[0].handler as { fanout: { max?: number } }).fanout.max;
    render(
      <WorkflowCanvas
        dataLayer={stubLayer({
          getActiveTeamDef: async () => ({ def_id: "d", name: "sdlc", version: 1, definition: bad }),
        })}
        teamName="sdlc"
      />,
    );
    const intake = await screen.findByTestId("node-intake");
    await waitFor(() => expect(intake.className).toContain("has-error"));
    expect(intake.textContent).toMatch(/ceiling is not optional/);
  });
});

describe("WorkflowCanvas — the mode scaffold (RFC CZ P2 / C5)", () => {
  // Typed parameters, not inferred: `vi.fn(async () => …)` infers a ZERO-arg
  // function, which makes mock.calls a tuple of length 0 and the assertion
  // below uncheckable. Declaring the target is what lets the test verify WHAT
  // was passed rather than merely that something was.
  type RunTarget = { name?: string; defId?: string; input?: string };
  const runTeamDetached = vi.fn(async (_target: RunTarget) => ({
    run_id: "r_abc",
    status: "running",
  }));

  const layer = (o: Partial<WorkflowDataLayer> = {}) =>
    stubLayer({ runTeamDetached, ...o });

  it("hides Run when the host wires no detached-run member", async () => {
    // Degrade, don't break: a host on an older runtime keeps a working editor.
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    await screen.findByTestId("node-code");
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });

  it("starts the walk by def_id, never by name", async () => {
    // Save-then-Run would otherwise execute the PREVIOUS version, and nothing
    // on screen would show the difference.
    runTeamDetached.mockClear();
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(runTeamDetached).toHaveBeenCalled());
    const arg = runTeamDetached.mock.calls[0][0];
    expect(arg.defId).toBe("def-1");
    expect(arg.name).toBeUndefined();
  });

  it("locks the graph for the life of the walk", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    // The editing affordances go, because the walk pins one def_id and the
    // canvas must keep describing what is actually running.
    await waitFor(() => expect(screen.queryByLabelText("Node palette")).toBeNull());
    expect(screen.queryByRole("button", { name: "Save new version" })).toBeNull();
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("offers Abort disabled, with a reason, when the host cannot cancel", async () => {
    // "Why can't I stop this" is the real question, so the button stays.
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    const abortBtn = await screen.findByRole("button", { name: "Abort" });
    expect((abortBtn as HTMLButtonElement).disabled).toBe(true);
    expect(abortBtn.getAttribute("title")).toMatch(/no way to stop/i);
  });

  it("stops a RUNNING walk through the runtime, then lands in Stopped", async () => {
    // RFC CZ C16 / loomcycle #1341. The cancel is addressed to the run id the
    // detached start returned.
    const cancelWalk = vi.fn(async (_runId: string, _reason: string) => ({ stopped: true }));
    render(<WorkflowCanvas dataLayer={layer({ cancelWalk })} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abort" }));
    await waitFor(() => expect(cancelWalk).toHaveBeenCalled());
    expect(cancelWalk.mock.calls[0][0]).toBe("r_abc");
    expect(await screen.findByText("Run aborted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to Edit" })).toBeTruthy();
  });

  it("keeps the walk live when the cancel fails, rather than claiming it stopped", async () => {
    // The regression this guards: Abort used to end the session LOCALLY and
    // call nothing, so the canvas said "aborted" over a walk still running.
    const cancelWalk = vi.fn(async (_runId: string, _reason: string): Promise<{ stopped: boolean }> => {
      throw new Error("409 not_interactive");
    });
    render(<WorkflowCanvas dataLayer={layer({ cancelWalk })} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abort" }));
    expect(await screen.findByText(/still running: 409 not_interactive/)).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to Edit" })).toBeNull();
  });

  it("says so when the walk had already ended before the cancel arrived", async () => {
    const cancelWalk = vi.fn(async (_runId: string, _reason: string) => ({ stopped: false }));
    render(<WorkflowCanvas dataLayer={layer({ cancelWalk })} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abort" }));
    expect(await screen.findByText("Ended (outcome not reported)")).toBeTruthy();
    expect(screen.getByText(/nothing was stopped/)).toBeTruthy();
  });

  it("does not offer Back to Edit while the walk is live", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await screen.findByText("Running");
    expect(screen.queryByRole("button", { name: "Back to Edit" })).toBeNull();
  });

  it("refuses to start a definition the runtime would reject", async () => {
    // The validation mirror already says it is broken; starting anyway would
    // just move the error to the server and lose the node highlighting.
    const broken = {
      entry: "a",
      states: [{ state: "a", handler: { kind: "agent" } }],
      transitions: [],
    };
    render(
      <WorkflowCanvas
        dataLayer={layer({
          getActiveTeamDef: async () => ({
            def_id: "d",
            name: "sdlc",
            version: 1,
            definition: broken,
          }),
        })}
        teamName="sdlc"
      />,
    );
    const btn = await screen.findByRole("button", { name: "Run" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    expect(btn.getAttribute("title")).toMatch(/validation problems/i);
  });

  it("explains a host that started the walk without a run id", async () => {
    // A host that swallowed the old-runtime refusal and fell back to a
    // blocking run returns a trace with no handle — nothing in Run mode can
    // address that, so it is reported rather than silently half-working.
    render(
      <WorkflowCanvas
        dataLayer={layer({ runTeamDetached: async () => ({ run_id: "" }) })}
        teamName="sdlc"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    expect(await screen.findByText(/cannot be monitored or stopped/i)).toBeTruthy();
    // And it stays in Edit — a failed start is not a run. The palette is the
    // Edit-only affordance now that "Add state" is gone.
    expect(screen.getByLabelText("Node palette")).toBeTruthy();
  });
});

describe("WorkflowCanvas — the node palette (RFC CZ C11/C12)", () => {
  it("offers nodes by ROLE, with no mention of states", async () => {
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    await screen.findByTestId("node-code");
    const palette = screen.getByLabelText("Node palette");
    for (const group of ["Sources", "Work", "Data", "End"]) {
      expect(palette.textContent, group).toContain(group);
    }
    // The vocabulary change is the point: "state" leaves the canvas.
    expect(palette.textContent).not.toMatch(/\bstate\b/i);
  });

  it("places a node named after its role and selects it for configuring", async () => {
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    await screen.findByTestId("node-code");
    fireEvent.click(screen.getByRole("button", { name: "Starter" }));
    // `starter-1`, not `state-5` — the id is the first thing read on a node.
    expect(await screen.findByTestId("node-starter-1")).toBeTruthy();
  });

  it("lists schedules and webhooks but will not place them", async () => {
    // C11: they live outside the definition, so the canvas names them as
    // context and refuses to own them. Listing beats hiding — a Starter reads
    // a channel something must publish to.
    render(<WorkflowCanvas dataLayer={stubLayer()} teamName="sdlc" />);
    await screen.findByTestId("node-code");
    const trigger = screen.getByTitle(/ScheduleDef or WebhookDef/);
    expect(trigger.tagName).not.toBe("BUTTON");
    expect(trigger.textContent).toMatch(/referenced/);
  });
});

describe("WorkflowCanvas — binding nodes (RFC CZ P3)", () => {
  const withBindings = {
    entry: "plan",
    states: [
      {
        state: "plan",
        handler: {
          kind: "agent",
          agent: "architect",
          system_prompt: "Follow {{document:/specs/launch#Risks}} and {{memory:core_block}}.",
        },
      },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "plan", to: "done", on: "success" }],
  };
  const layer = () =>
    stubLayer({
      getActiveTeamDef: async () => ({ def_id: "d", name: "sdlc", version: 1, definition: withBindings }),
    });

  it("draws a node for each Document and Memory a prompt pulls in", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    const doc = await screen.findByTestId("binding-document-/specs/launch#Risks");
    expect(doc.textContent).toMatch(/inlined into the prompt/);
    expect(await screen.findByTestId("binding-memory-core_block")).toBeTruthy();
  });

  it("says an unknown memory section renders empty — a save does not refuse it", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    expect(await screen.findByText(/names \{\{memory:core_block\}\}, which this runtime does not know/)).toBeTruthy();
    // info, not an error: the runtime accepts it, so Save stays available.
    expect((screen.getByRole("button", { name: "Save new version" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a selected binding's details, read-only", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    fireEvent.click(await screen.findByTestId("binding-document-/specs/launch#Risks"));
    const panel = (await screen.findByText(/cannot decline to read it/)).closest("aside")!;
    expect(panel.textContent).toMatch(/plan \(system_prompt\)/);
  });
});

describe("WorkflowCanvas — the live walk (RFC CZ M3)", () => {
  type Rows = (rows: WalkRunRow[]) => void;
  // A host whose watchWalk hands the test the row sink, so the test plays the
  // runtime: it decides what the walk's runs do and when.
  const harness = () => {
    let push: Rows = () => undefined;
    const stop = vi.fn();
    const watchWalk = vi.fn((_id: string, onRows: Rows) => {
      push = onRows;
      return stop;
    });
    const runTeamDetached = vi.fn(async () => ({ run_id: "r_walk", status: "running" }));
    const layer = stubLayer({ watchWalk, runTeamDetached });
    return { layer, watchWalk, stop, push: (rows: WalkRunRow[]) => act(() => push(rows)) };
  };
  const row = (o: Partial<WalkRunRow> & { runId: string }): WalkRunRow => ({
    agentId: "a",
    agent: "x",
    status: "running",
    ts: "2026-10-01T10:00:00Z",
    ...o,
  });

  it("watches the walk it started, by run id", async () => {
    const h = harness();
    render(<WorkflowCanvas dataLayer={h.layer} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(h.watchWalk).toHaveBeenCalled());
    expect(h.watchWalk.mock.calls[0][0]).toBe("r_walk");
  });

  it("shows each state's live runs on its node", async () => {
    const h = harness();
    render(<WorkflowCanvas dataLayer={h.layer} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(h.watchWalk).toHaveBeenCalled());
    h.push([
      row({ runId: "r_walk" }),
      row({ runId: "m1", state: "code", status: "completed" }),
      row({ runId: "m2", state: "code", awaited: "review" }),
    ]);
    expect((await screen.findByTestId("pulse-code")).textContent).toBe("1/2 done · 1 held");
  });

  it("ENDS the session when the walk's own run ends, so Back to Edit appears", async () => {
    // Regression: nothing told the canvas a walk had finished, so it stayed
    // "Running" — and Back to Edit unreachable — until a reload.
    const h = harness();
    render(<WorkflowCanvas dataLayer={h.layer} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(h.watchWalk).toHaveBeenCalled());
    h.push([row({ runId: "r_walk" })]);
    h.push([row({ runId: "r_walk", status: "completed", ts: "2026-10-01T10:05:00Z" })]);
    expect(await screen.findByText("Finished")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to Edit" })).toBeTruthy();
  });

  it("names the walk beside its phase, with no start notice left saying Running after it ends", async () => {
    // Regression: the start set a "Running (r_walk)." notice nothing cleared,
    // so a failed walk read "Run failed" and "Running (…)" side by side.
    const h = harness();
    render(<WorkflowCanvas dataLayer={h.layer} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(h.watchWalk).toHaveBeenCalled());
    h.push([row({ runId: "r_walk", status: "failed", ts: "2026-10-01T10:05:00Z" })]);
    expect(await screen.findByText("Run failed")).toBeTruthy();
    expect(screen.queryByText(/Running/)).toBeNull();
    expect(screen.getByTestId("walk-id").textContent).toBe("r_walk");
  });

  it("parks the session while the walk waits at a breakpoint, and releases it", async () => {
    const h = harness();
    render(<WorkflowCanvas dataLayer={h.layer} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(h.watchWalk).toHaveBeenCalled());
    h.push([row({ runId: "r_walk", awaited: "interrupted", ts: "2026-10-01T10:01:00Z" })]);
    expect(await screen.findByText("Paused at a breakpoint")).toBeTruthy();
    h.push([row({ runId: "r_walk", ts: "2026-10-01T10:02:00Z" })]);
    expect(await screen.findByText("Debugging")).toBeTruthy();
  });

  it("stops watching when the operator goes back to Edit", async () => {
    const h = harness();
    render(<WorkflowCanvas dataLayer={h.layer} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(h.watchWalk).toHaveBeenCalled());
    h.push([row({ runId: "r_walk", status: "completed" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Back to Edit" }));
    expect(h.stop).toHaveBeenCalled();
    expect(screen.queryByTestId("pulse-code")).toBeNull();
  });
});

describe("WorkflowCanvas — runs and output (RFC CZ M3b)", () => {
  const pipeline = {
    entry: "research",
    channels: { subscribe: ["parts-in", "research-out"], publish: ["research-out", "articles-out"] },
    states: [
      { state: "research", handler: { kind: "starter", source: { channel: "parts-in" }, fanout: { agent: "r", max: 2 }, sink: { channel: "research-out" } } },
      { state: "edit", handler: { kind: "starter", source: { channel: "research-out" }, fanout: { agent: "e", max: 2 }, sink: { channel: "articles-out" } } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "research", to: "edit", on: "success" },
      { from: "edit", to: "done", on: "success" },
    ],
  };
  const base = (o: Partial<WorkflowDataLayer> = {}) =>
    stubLayer({
      getActiveTeamDef: async () => ({ def_id: "d", name: "sdlc", version: 1, definition: pipeline }),
      listChannels: async () => ["parts-in", "research-out", "articles-out"].map((name) => ({ name, scope: "tenant" })),
      ...o,
    });

  it("shows the team's OUTPUT channel — what it publishes and does not read", async () => {
    const peekChannel = vi.fn(async () => [
      { id: "m1", publishedAt: "2026-10-01T10:00:00Z", value: { status: "ok", output: "article_chunk_42" } },
    ]);
    render(<WorkflowCanvas dataLayer={base({ peekChannel })} teamName="sdlc" />);
    expect(await screen.findByTestId("output-articles-out")).toBeTruthy();
    expect(await screen.findByText("article_chunk_42")).toBeTruthy();
    // Internal wiring is not output.
    expect(screen.queryByTestId("output-research-out")).toBeNull();
    expect(peekChannel).toHaveBeenCalledWith("articles-out", expect.objectContaining({ scope: "tenant" }));
  });

  it("lists a selected node's runs while a walk is on screen", async () => {
    let push: (rows: WalkRunRow[]) => void = () => undefined;
    const watchWalk = vi.fn((_id: string, onRows: (rows: WalkRunRow[]) => void) => {
      push = onRows;
      return () => undefined;
    });
    const runTeamDetached = vi.fn(async () => ({ run_id: "r_walk", status: "running" }));
    const readRun = vi.fn(async (runId: string) => ({ runId, status: "completed", finalText: "research_chunk_7" }));
    render(<WorkflowCanvas dataLayer={base({ watchWalk, runTeamDetached, readRun })} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(watchWalk).toHaveBeenCalled());
    act(() =>
      push([
        { runId: "r_walk", agentId: "w", agent: "team:sdlc", status: "running", ts: "2026-10-01T10:00:00Z" },
        { runId: "m1", agentId: "a", agent: "marketing/researcher", status: "completed", ts: "2026-10-01T10:01:00Z", state: "research" },
      ]),
    );
    fireEvent.click(await screen.findByTestId("node-research"));
    fireEvent.click(await screen.findByRole("button", { name: /completed.*marketing\/researcher/ }));
    expect(await screen.findByText("research_chunk_7")).toBeTruthy();
  });

  it("lets the operator switch transitions off — on by default, and not an edit", async () => {
    const onSaved = vi.fn();
    render(<WorkflowCanvas dataLayer={base()} teamName="sdlc" onSaved={onSaved} />);
    const toggle = (await screen.findByRole("checkbox", { name: /Transitions/ })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    // Presentation only: the graph is untouched, so nothing new to save.
    expect(screen.getByTestId("node-edit")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the walk's RESULT on the End node it finished at — read from the walk's run", async () => {
    let push: (rows: WalkRunRow[]) => void = () => undefined;
    const watchWalk = vi.fn((_id: string, onRows: (rows: WalkRunRow[]) => void) => {
      push = onRows;
      return () => undefined;
    });
    const runTeamDetached = vi.fn(async () => ({ run_id: "r_walk", status: "running" }));
    const finalText = JSON.stringify({
      results: [{ index: 0, agent: "e", run_id: "m2", ok: true, output: "[sub-agent agent_id=a_1]\narticle_chunk_42" }],
    });
    const readRun = vi.fn(async (runId: string) => ({ runId, status: "completed", finalText, terminal: "done" }));
    render(<WorkflowCanvas dataLayer={base({ watchWalk, runTeamDetached, readRun })} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(watchWalk).toHaveBeenCalled());
    const walkRow = (status: string, ts: string): WalkRunRow => ({ runId: "r_walk", agentId: "w", agent: "team:sdlc", status, ts });
    act(() =>
      push([
        walkRow("running", "2026-10-01T10:00:00Z"),
        { runId: "m1", agentId: "a", agent: "r", status: "completed", ts: "2026-10-01T10:01:00Z", state: "research" },
        { runId: "m2", agentId: "b", agent: "e", status: "completed", ts: "2026-10-01T10:02:00Z", state: "edit" },
      ]),
    );
    // Not before the walk has finished: there is no result yet.
    expect(screen.queryByTestId("result-done")).toBeNull();
    act(() => push([walkRow("completed", "2026-10-01T10:03:00Z")]));
    const result = await screen.findByTestId("result-done");
    expect(readRun).toHaveBeenCalledWith("r_walk");
    expect(result.textContent).toContain("article_chunk_42");
    expect(result.textContent).not.toContain("[sub-agent");
  });

  it("colours where a running walk is — active, passed, and a marker on the current state — and resets when it ends", async () => {
    let push: (rows: WalkRunRow[]) => void = () => undefined;
    const watchWalk = vi.fn((_id: string, onRows: (rows: WalkRunRow[]) => void) => {
      push = onRows;
      return () => undefined;
    });
    const readRun = vi.fn(async (runId: string) => ({ runId, status: "completed", finalText: "a1", terminal: "done" }));
    render(
      <WorkflowCanvas
        dataLayer={base({ watchWalk, runTeamDetached: async () => ({ run_id: "r_walk", status: "running" }), readRun })}
        teamName="sdlc"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(watchWalk).toHaveBeenCalled());
    const walkRow = (status: string, ts: string): WalkRunRow => ({ runId: "r_walk", agentId: "w", agent: "team:sdlc", status, ts });
    act(() =>
      push([
        walkRow("running", "2026-10-01T10:00:00Z"),
        { runId: "m1", agentId: "a", agent: "r", status: "completed", ts: "2026-10-01T10:01:00Z", state: "research", stateVisit: 1 },
        { runId: "m2", agentId: "b", agent: "e", status: "running", ts: "2026-10-01T10:02:00Z", state: "edit", stateVisit: 2 },
      ]),
    );
    const edit = await screen.findByTestId("node-edit");
    await waitFor(() => expect(edit.className).toContain("is-active"));
    expect(screen.getByTestId("agent-edit").className).toContain("is-active");
    expect(screen.getByTestId("node-research").className).toContain("is-passed");
    expect(screen.getByTestId("current-edit")).toBeTruthy();
    expect(screen.queryByTestId("current-research")).toBeNull();

    act(() => push([walkRow("completed", "2026-10-01T10:03:00Z")]));
    await waitFor(() => expect(screen.getByTestId("node-edit").className).not.toContain("is-active"));
    expect(screen.getByTestId("node-research").className).not.toContain("is-passed");
    expect(screen.queryByTestId("current-edit")).toBeNull();
    // What it produced stays: the End node keeps the result.
    expect(await screen.findByTestId("result-done")).toBeTruthy();
  });

  it("puts the result on the End node the RUNTIME says the walk reached, not the one its success edge leads to (G14)", async () => {
    let push: (rows: WalkRunRow[]) => void = () => undefined;
    const watchWalk = vi.fn((_id: string, onRows: (rows: WalkRunRow[]) => void) => {
      push = onRows;
      return () => undefined;
    });
    const twoEnds = {
      ...pipeline,
      states: [...pipeline.states, { state: "gave-up", handler: { kind: "terminal" } }],
      transitions: [...pipeline.transitions, { from: "edit", to: "gave-up", on: "pushback:stop" }],
    };
    const readRun = vi.fn(async (runId: string) => ({ runId, status: "completed", finalText: "no article", terminal: "gave-up" }));
    render(
      <WorkflowCanvas
        dataLayer={base({
          getActiveTeamDef: async () => ({ def_id: "d", name: "sdlc", version: 1, definition: twoEnds }),
          watchWalk,
          runTeamDetached: async () => ({ run_id: "r_walk", status: "running" }),
          readRun,
        })}
        teamName="sdlc"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(watchWalk).toHaveBeenCalled());
    act(() =>
      push([
        { runId: "m2", agentId: "b", agent: "e", status: "completed", ts: "2026-10-01T10:02:00Z", state: "edit" },
        { runId: "r_walk", agentId: "w", agent: "team:sdlc", status: "completed", ts: "2026-10-01T10:03:00Z" },
      ]),
    );
    expect((await screen.findByTestId("result-gave-up")).textContent).toContain("no article");
    expect(screen.queryByTestId("result-done")).toBeNull();
  });

  it("opens a Starter's runs from its AGENT node, and counts them there", async () => {
    // The agent node is the Starter's fan-out, not a state: selecting it must
    // select the Starter, or the inspector would have nothing to show.
    let push: (rows: WalkRunRow[]) => void = () => undefined;
    const watchWalk = vi.fn((_id: string, onRows: (rows: WalkRunRow[]) => void) => {
      push = onRows;
      return () => undefined;
    });
    const runTeamDetached = vi.fn(async () => ({ run_id: "r_walk", status: "running" }));
    render(<WorkflowCanvas dataLayer={base({ watchWalk, runTeamDetached })} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(watchWalk).toHaveBeenCalled());
    act(() =>
      push([
        { runId: "r_walk", agentId: "w", agent: "team:sdlc", status: "running", ts: "2026-10-01T10:00:00Z" },
        { runId: "m1", agentId: "a", agent: "marketing/researcher", status: "completed", ts: "2026-10-01T10:01:00Z", state: "research" },
      ]),
    );
    const agent = await screen.findByTestId("agent-research");
    expect(agent.textContent).toContain("1/1 done");
    expect(screen.getByTestId("node-research").textContent).not.toContain("1/1 done");
    fireEvent.click(agent);
    expect(await screen.findByRole("button", { name: /completed.*marketing\/researcher/ })).toBeTruthy();
  });
});

describe("WorkflowCanvas — the Input node (RFC CZ)", () => {
  // pcparts as it runs on TrueNAS, without and with its Input node.
  const states = [
    { state: "research", handler: { kind: "starter", source: { channel: "pcparts-in" }, fanout: { agent: "r", max: 1 }, sink: { channel: "handoff" } } },
    { state: "edit", handler: { kind: "starter", source: { channel: "handoff" }, fanout: { agent: "e", max: 1 }, sink: { channel: "articles" } } },
    { state: "done", handler: { kind: "terminal" } },
  ];
  const transitions = [
    { from: "research", to: "edit", on: "success" },
    { from: "edit", to: "done", on: "success" },
  ];
  const channelsAcl = { subscribe: ["pcparts-in", "handoff"], publish: ["pcparts-in", "handoff", "articles"] };
  const withForm = {
    entry: "form",
    channels: channelsAcl,
    states: [
      {
        state: "form",
        handler: {
          kind: "input",
          schema: {
            type: "object",
            required: ["document_id", "chunk_id"],
            properties: { document_id: { type: "string", title: "Document" }, chunk_id: { type: "string", title: "Part" } },
          },
          capture: { document_id: "$.document_id", chunk_id: "$.chunk_id" },
          publish: { channel: "pcparts-in" },
        },
      },
      ...states,
    ],
    transitions: [{ from: "form", to: "research", on: "success" }, ...transitions],
  };
  const layerFor = (definition: unknown, o: Partial<WorkflowDataLayer> = {}) =>
    stubLayer({
      getActiveTeamDef: async () => ({ def_id: "d1", name: "pcparts", version: 1, definition }),
      getTeamDef: async () => ({ def_id: "d1", name: "pcparts", version: 1, definition }),
      listChannels: async () => ["pcparts-in", "handoff", "articles"].map((name) => ({ name, scope: "user" })),
      ...o,
    });

  it("places an Input form as the ENTRY, wired into the old entry — no 'unreachable' or 'dead end'", async () => {
    // Regression: it was dropped loose, refused on the spot by both rules.
    render(<WorkflowCanvas dataLayer={layerFor({ entry: "research", channels: channelsAcl, states, transitions })} teamName="pcparts" />);
    await screen.findByTestId("node-research");
    fireEvent.click(screen.getByRole("button", { name: "Input form" }));
    expect(await screen.findByTestId("node-input-1")).toBeTruthy();
    expect(screen.queryByText(/unreachable from entry/)).toBeNull();
    expect(screen.queryByText(/no outbound transition/)).toBeNull();
    expect(screen.getByTestId("node-input-1").textContent).toContain("entry");
  });

  it("starts pcparts from its form with ONE run — the Input's `publish` puts the form on the channel, not the browser", async () => {
    // Regression: Start published {document_id, chunk_id} from the browser,
    // then ran (G15's stopgap). The runtime does it now (loomcycle #1577).
    const publishChannel = vi.fn(async () => undefined);
    const runTeamDetached = vi.fn(async () => ({ run_id: "r_walk", status: "running" }));
    render(<WorkflowCanvas dataLayer={layerFor(withForm, { publishChannel, runTeamDetached })} teamName="pcparts" />);
    const form = await screen.findByTestId("node-form");
    expect(form.textContent).toContain("${var.document_id}");
    fireEvent.click(within(await screen.findByTestId("node-form")).getByText("Start…"));
    fireEvent.change(await screen.findByLabelText(/Document/), { target: { value: "doc-parts" } });
    fireEvent.change(screen.getByLabelText(/Part/), { target: { value: "gpu" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(runTeamDetached).toHaveBeenCalled());
    expect(runTeamDetached).toHaveBeenCalledWith({ defId: "d1", input: JSON.stringify({ document_id: "doc-parts", chunk_id: "gpu" }) });
    expect(publishChannel).not.toHaveBeenCalled();
    // Drawn from the definition, and valid: nothing to fix before Start.
    expect(screen.queryByText(/\d+ problems?/)).toBeNull();
    expect(screen.getByTestId("node-form").textContent).toContain("pcparts-in");
  });

  it("refuses to Start while the graph differs from the saved version — Start would run the old one", async () => {
    const runTeamDetached = vi.fn(async () => ({ run_id: "r_walk", status: "running" }));
    render(<WorkflowCanvas dataLayer={layerFor(withForm, { runTeamDetached, publishChannel: vi.fn() })} teamName="pcparts" />);
    await screen.findByTestId("node-form");
    // An unsaved edit: add a field through the form editor.
    fireEvent.click(screen.getByTestId("node-form"));
    fireEvent.change(await screen.findByLabelText("New field name"), { target: { value: "tone" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.click(within(await screen.findByTestId("node-form")).getByText("Start…"));
    expect(await screen.findByText(/Save a new version first/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
    expect(runTeamDetached).not.toHaveBeenCalled();
  });
});

describe("WorkflowCanvas — a Starter reading the walk's input (loomcycle #1579)", () => {
  // pcparts v2: no channels at all. The entry Starter takes the input; the
  // editor is an agent state the walk feeds.
  const v2 = {
    entry: "research",
    states: [
      {
        state: "research",
        handler: {
          kind: "starter",
          source: { channel: "", kind: "input" },
          schema: {
            type: "object",
            required: ["document_id", "chunk_id"],
            properties: { document_id: { type: "string", title: "Document" }, chunk_id: { type: "string", title: "Part" } },
          },
          fanout: { agent: "marketing/researcher", per: "message", max: 1 },
          binds: { document_id: "$.document_id", chunk_id: "$.chunk_id" },
          capture: { research: "$.results[0].output" },
        },
      },
      { state: "edit", handler: { kind: "agent", agent: "marketing/article-editor" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "research", to: "edit", on: "success" },
      { from: "edit", to: "done", on: "success" },
    ],
  };
  const layer = (o: Partial<WorkflowDataLayer> = {}) =>
    stubLayer({
      getActiveTeamDef: async () => ({ def_id: "d2", name: "pcparts", version: 2, definition: v2 }),
      getTeamDef: async () => ({ def_id: "d2", name: "pcparts", version: 2, definition: v2 }),
      listChannels: async () => [],
      ...o,
    });

  it("shows the channel-free team as valid — the mirror knows an input source", async () => {
    // Regression: the mirror required `source.channel` on every Starter, so
    // this definition (accepted by the runtime) came up red and Run was off.
    render(<WorkflowCanvas dataLayer={layer()} teamName="pcparts" />);
    const research = await screen.findByTestId("node-research");
    expect(screen.queryByText(/\d+ problems?/)).toBeNull();
    expect(research.textContent).toContain("the walk's input");
    expect(research.textContent).toContain("${var.chunk_id}");
  });

  it("starts with ONE run carrying the input — nothing is published", async () => {
    const publishChannel = vi.fn(async () => undefined);
    const runTeamDetached = vi.fn(async () => ({ run_id: "r_walk", status: "running" }));
    render(<WorkflowCanvas dataLayer={layer({ publishChannel, runTeamDetached })} teamName="pcparts" />);
    fireEvent.click(within(await screen.findByTestId("node-research")).getByText("Start…"));
    fireEvent.change(await screen.findByLabelText(/Document/), { target: { value: "doc-parts" } });
    fireEvent.change(screen.getByLabelText(/Part/), { target: { value: "ddr5" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(runTeamDetached).toHaveBeenCalled());
    expect(runTeamDetached).toHaveBeenCalledWith({ defId: "d2", input: JSON.stringify({ document_id: "doc-parts", chunk_id: "ddr5" }) });
    expect(publishChannel).not.toHaveBeenCalled();
  });
});
