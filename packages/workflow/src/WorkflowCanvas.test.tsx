// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "./WorkflowCanvas";
import type { TeamDefDetail, WorkflowDataLayer } from "./types";

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

  it("draws a Starter as a dispatcher: what it reads, how wide, where results go", async () => {
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    const intake = await screen.findByTestId("node-intake");
    expect(intake.className).toContain("lb-wf-node--starter");
    expect(intake.className).not.toContain("lb-wf-node--opaque");
    expect(intake.textContent).toContain("sdlc-intake");
    expect(intake.textContent).toContain("architect");
    expect(intake.textContent).toContain("one run per message · max 8");
    expect(intake.textContent).toContain("sdlc-plans");
  });

  it("reads a Starter's agents from fanout, not from the handler's top level", async () => {
    // The runtime refuses a top-level `agent` on a starter, so `fanout.agent`
    // is the only place the name can legitimately live.
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    expect((await screen.findByTestId("node-plan")).textContent).toContain("coder");
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

  it("offers Abort but disabled, with the reason the runtime cannot stop a walk", async () => {
    // Verified against loomcycle f08068b7: run-cancel is interactive-only
    // (409) and the agents route rejects the walk's `team:<name>` agent id
    // (400). A live button would simply error, so it is shown-and-disabled
    // with the explanation — "why can't I stop this" is the real question.
    render(<WorkflowCanvas dataLayer={layer()} teamName="sdlc" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    const abortBtn = await screen.findByRole("button", { name: "Abort" });
    expect((abortBtn as HTMLButtonElement).disabled).toBe(true);
    expect(abortBtn.getAttribute("title")).toMatch(/not paused/i);
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
