import { describe, expect, it } from "vitest";
import {
  HANDLE,
  edgeClass,
  edgeId,
  fanoutSummary,
  isBackward,
  toDataEdges,
  toFlowEdges,
  toFlowNodes,
} from "./flow";
import { fromDefinition } from "./model";
import { validateModel } from "./validate";

const model = fromDefinition({
  entry: "code",
  states: [
    { state: "code", handler: { kind: "agent", agent: "coder", consolidator: "judge" } },
    {
      state: "review",
      handler: { kind: "parallel", agents: ["sec", "qa"], wait: "at_least:2", consolidator: "judge" },
    },
    { state: "ship", handler: { kind: "from-a-newer-runtime", source: { channel: "x" } } },
    { state: "done", handler: { kind: "terminal" } },
  ],
  transitions: [
    { from: "code", to: "review", on: "success" },
    { from: "review", to: "done", on: "success" },
    { from: "review", to: "code", on: "pushback:redo" },
    { from: "code", to: "ship", on: "conditional:ready" },
  ],
});

describe("edgeClass", () => {
  it("maps each label family to its own modifier", () => {
    expect(edgeClass("success")).toContain("--success");
    expect(edgeClass("pushback:redo")).toContain("--pushback");
    expect(edgeClass("conditional:x > 1")).toContain("--conditional");
  });

  it("gives every pushback reason the same class", () => {
    // One class per reason would be unbounded; the reason lives in the label.
    expect(edgeClass("pushback:redo")).toBe(edgeClass("pushback:rework"));
  });
});

describe("edgeId", () => {
  it("is stable across reordering and unique per outbound label", () => {
    const [a, , c] = model.edges;
    expect(edgeId(a)).toBe("code success review");
    expect(edgeId(c)).toBe("review pushback:redo code");
    expect(new Set(model.edges.map(edgeId)).size).toBe(model.edges.length);
  });
});

describe("toFlowNodes", () => {
  const findings = validateModel(model);
  const nodes = toFlowNodes(model, findings, "review");

  it("flags the entry state", () => {
    expect(nodes.find((n) => n.id === "code")!.data.isEntry).toBe(true);
    expect(nodes.find((n) => n.id === "review")!.data.isEntry).toBe(false);
  });

  it("carries the agents each state runs", () => {
    expect(nodes.find((n) => n.id === "code")!.data.agents).toEqual(["coder"]);
    expect(nodes.find((n) => n.id === "review")!.data.agents).toEqual(["sec", "qa"]);
    expect(nodes.find((n) => n.id === "done")!.data.agents).toEqual([]);
  });

  it("carries the parallel wait policy and consolidator", () => {
    const review = nodes.find((n) => n.id === "review")!.data;
    expect(review.wait).toBe("at_least:2");
    expect(review.consolidator).toBe("judge");
  });

  it("marks the selected node", () => {
    expect(nodes.find((n) => n.id === "review")!.selected).toBe(true);
    expect(nodes.find((n) => n.id === "code")!.selected).toBe(false);
  });

  it("routes each finding to its own node, errors before info", () => {
    // `ship` is an unknown kind → exactly one info finding, no errors.
    const ship = nodes.find((n) => n.id === "ship")!.data.findings;
    expect(ship).toHaveLength(1);
    expect(ship[0].level).toBe("info");
    expect(nodes.find((n) => n.id === "code")!.data.findings).toEqual([]);
  });
});

describe("toFlowEdges", () => {
  const edges = toFlowEdges(model, validateModel(model));

  it("hides the success label and shows named routes", () => {
    // `success` on every edge is noise — the arrow already says "and then".
    expect(edges.find((e) => e.id === "code success review")!.label).toBe("");
    expect(edges.find((e) => e.id === "review pushback:redo code")!.label).toBe("pushback:redo");
    expect(edges.find((e) => e.id === "code conditional:ready ship")!.label).toBe(
      "conditional:ready",
    );
  });

  it("tags every edge as control flow", () => {
    // Data edges (RFC CZ C1) arrive with the Starter; the discriminator is
    // already carried so that addition does not reshape this contract.
    expect(edges.every((e) => e.data.kind === "control")).toBe(true);
  });

  it("preserves source and target", () => {
    const e = edges.find((x) => x.id === "review pushback:redo code")!;
    expect([e.source, e.target]).toEqual(["review", "code"]);
  });
});

// The pushback loop is THE characteristic shape of a team graph, and it is
// what shipped broken: with only a right source and a left target handle, a
// backward edge left the source's right side and re-entered the target's
// left, curving back through the nodes and stacking on top of the forward
// edge between the same pair so only one label was legible.
describe("backward edge routing", () => {
  // draft ⇄ edit is reciprocal — draft → edit forward, edit → draft pushback,
  // which is the marketing template's real shape.
  const reciprocal = fromDefinition({
    entry: "draft",
    states: [
      { state: "draft", handler: { kind: "agent", agent: "w" } },
      { state: "edit", handler: { kind: "agent", agent: "e" } },
      { state: "published", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "draft", to: "edit", on: "success" },
      { from: "edit", to: "published", on: "success" },
      { from: "edit", to: "draft", on: "pushback:revise" },
    ],
    layout: {
      nodes: { draft: { x: 0, y: 0 }, edit: { x: 280, y: 0 }, published: { x: 560, y: 0 } },
    },
  });

  it("reads direction from the laid-out positions", () => {
    expect(isBackward(reciprocal, "draft", "edit")).toBe(false);
    expect(isBackward(reciprocal, "edit", "draft")).toBe(true);
  });

  it("treats a self-transition as a loop", () => {
    expect(isBackward(reciprocal, "edit", "edit")).toBe(true);
  });

  it("routes a forward edge across the row and a backward one under it", () => {
    const edges = toFlowEdges(reciprocal, []);
    const fwd = edges.find((e) => e.id === "draft success edit")!;
    const back = edges.find((e) => e.id === "edit pushback:revise draft")!;

    expect([fwd.sourceHandle, fwd.targetHandle]).toEqual([HANDLE.sourceRight, HANDLE.targetLeft]);
    expect([back.sourceHandle, back.targetHandle]).toEqual([
      HANDLE.sourceBottom,
      HANDLE.targetBottom,
    ]);
  });

  it("gives a reciprocal pair different handles so neither hides the other", () => {
    const edges = toFlowEdges(reciprocal, []);
    const fwd = edges.find((e) => e.id === "draft success edit")!;
    const back = edges.find((e) => e.id === "edit pushback:revise draft")!;
    // Same node pair, so the ONLY thing separating the two paths is the
    // handle PAIR. Comparing the handles individually would pass even when
    // both edges route right→left, which is the bug — assert the pairs differ.
    expect([back.sourceHandle, back.targetHandle]).not.toEqual([
      fwd.sourceHandle,
      fwd.targetHandle,
    ]);
  });

  it("uses smoothstep for a backward edge and the default curve forward", () => {
    const edges = toFlowEdges(reciprocal, []);
    expect(edges.find((e) => e.id === "edit pushback:revise draft")!.type).toBe("smoothstep");
    expect(edges.find((e) => e.id === "draft success edit")!.type).toBeUndefined();
  });

  it("does not call a same-column edge backward", () => {
    const stacked = fromDefinition({
      entry: "a",
      states: [
        { state: "a", handler: { kind: "agent", agent: "x" } },
        { state: "b", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "a", to: "b", on: "success" }],
      layout: { nodes: { a: { x: 100, y: 0 }, b: { x: 100, y: 150 } } },
    });
    expect(isBackward(stacked, "a", "b")).toBe(false);
  });
});

describe("edge direction is visible", () => {
  it("puts an arrowhead on every edge", () => {
    // Without a marker the only cue for direction is node position, which is
    // exactly wrong for a backward edge.
    const edges = toFlowEdges(model, []);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.markerEnd.type).toBe("arrowclosed");
    }
  });

  it("lets the arrowhead inherit the edge colour rather than hardcoding one", () => {
    // `context-stroke` keeps success / pushback / conditional arrows matching
    // their line in BOTH themes; a literal colour here would drift from
    // styles.css the first time the palette changed.
    for (const e of toFlowEdges(model, [])) {
      expect(e.markerEnd.color).toBe("context-stroke");
    }
  });
});

describe("fanoutSummary", () => {
  const starter = (fanout: unknown) =>
    fromDefinition({
      entry: "s",
      states: [{ state: "s", handler: { kind: "starter", source: { channel: "in" }, fanout } }],
      transitions: [],
    }).nodes[0];

  it("states the RULE and its ceiling, never a run count", () => {
    // Width is a runtime property (decision C3): per=message means "as many
    // runs as there are messages on the channel", which the canvas cannot know.
    expect(fanoutSummary(starter({ agent: "a", per: "message", max: 8 }))).toBe(
      "one run per message · max 8",
    );
  });

  it("defaults to per=message when `per` is absent, matching the runtime", () => {
    expect(fanoutSummary(starter({ agent: "a", max: 3 }))).toBe("one run per message · max 3");
  });

  it("describes per=once as the single run it is", () => {
    expect(fanoutSummary(starter({ agent: "a", per: "once" }))).toBe("one run · whole batch");
  });

  it("says nothing for a kind that has no wave", () => {
    const m = fromDefinition({
      entry: "s",
      states: [{ state: "s", handler: { kind: "agent", agent: "a" } }],
      transitions: [],
    });
    expect(fanoutSummary(m.nodes[0])).toBeUndefined();
  });
});

describe("toDataEdges", () => {
  // intake ──(raw)──▶ triage ──(triaged)──▶ work
  //                         also a CONTROL edge triage → work, so the two
  //                         relations share a node pair — the case that matters.
  const wired = fromDefinition({
    entry: "intake",
    states: [
      {
        state: "intake",
        handler: { kind: "starter", source: { channel: "inbox" }, fanout: { agent: "a", max: 2 }, sink: { channel: "raw" } },
      },
      {
        state: "triage",
        handler: { kind: "starter", source: { channel: "raw" }, fanout: { agent: "b", max: 2 }, sink: { channel: "triaged" } },
      },
      {
        state: "work",
        handler: { kind: "starter", source: { channel: "triaged" }, fanout: { agent: "c", max: 2 } },
      },
      { state: "shout", handler: { kind: "channel", channel: "raw" } },
      { state: "orphan", handler: { kind: "channel", channel: "nobody-reads-this" } },
    ],
    transitions: [{ from: "triage", to: "work", on: "success" }],
  });

  it("derives an edge wherever a sink channel meets a source channel", () => {
    const pairs = toDataEdges(wired).map((e) => `${e.source}→${e.target}:${e.data.channel}`).sort();
    expect(pairs).toEqual([
      "intake→triage:raw",
      "shout→triage:raw",
      "triage→work:triaged",
    ]);
  });

  it("derives nothing from a sink no state reads", () => {
    // Publishing where nobody listens is legitimate — results parked for a
    // human — so it is silently no edge, not a finding.
    expect(toDataEdges(wired).some((e) => e.source === "orphan")).toBe(false);
  });

  it("routes data over the top handles so it cannot stack on a control edge", () => {
    // triage → work exists in BOTH relations. If they shared handles they would
    // render as one path and decision C1 would be violated in the only case
    // where it is actually load-bearing.
    const data = toDataEdges(wired).find((e) => e.source === "triage" && e.target === "work")!;
    const control = toFlowEdges(wired, []).find((e) => e.source === "triage" && e.target === "work")!;
    expect([data.sourceHandle, data.targetHandle]).toEqual([HANDLE.sourceTop, HANDLE.targetTop]);
    expect([control.sourceHandle, control.targetHandle]).not.toEqual([
      data.sourceHandle,
      data.targetHandle,
    ]);
  });

  it("gives a data edge an id that cannot collide with a transition's", () => {
    const control = toFlowEdges(wired, []).map((e) => e.id);
    for (const e of toDataEdges(wired)) expect(control).not.toContain(e.id);
  });

  it("labels a data edge with its channel", () => {
    // Unlike `success` on a control edge, the channel is the whole content of
    // the relation — an unlabelled data edge says only "connected somehow".
    for (const e of toDataEdges(wired)) expect(e.label).toBe(e.data.channel);
  });

  it("marks derived edges undeletable", () => {
    // The way to remove one is to change a channel name in the inspector.
    for (const e of toDataEdges(wired)) expect(e.deletable).toBe(false);
  });

  it("draws a starter that republishes to the channel it reads", () => {
    const loop = fromDefinition({
      entry: "s",
      states: [
        {
          state: "s",
          handler: { kind: "starter", source: { channel: "q" }, fanout: { agent: "a", max: 1 }, sink: { channel: "q" } },
        },
      ],
      transitions: [],
    });
    // Drawn rather than suppressed: it is a real and usually unintended loop,
    // and seeing it is the point of having the relation on screen at all.
    expect(toDataEdges(loop)).toHaveLength(1);
    expect(toDataEdges(loop)[0].source).toBe("s");
    expect(toDataEdges(loop)[0].target).toBe("s");
  });
});
