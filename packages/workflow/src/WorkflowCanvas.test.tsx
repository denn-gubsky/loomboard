// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.queryByText("Add state")).toBeNull();
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
