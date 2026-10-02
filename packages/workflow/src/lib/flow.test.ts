import { describe, expect, it } from "vitest";
import {
  AGENT_HANDLE,
  HANDLE,
  edgeClass,
  edgeId,
  fanoutSummary,
  followsData,
  hookLabels,
  isBackward,
  mergeMeasured,
  toDataEdges,
  toFlowEdges,
  toFlowNodes,
  visibleEdges,
} from "./flow";
import { fromDefinition } from "./model";
import { channelNodes } from "./channelNodes";
import { agentNodes } from "./agentNodes";
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

  it("labels every transition with the step it takes, and a named route with its route", () => {
    // Unlabelled, a transition beside a data row read as a second data path.
    expect(edges.find((e) => e.id === "code success review")!.label).toBe("code → review");
    expect(edges.find((e) => e.id === "review pushback:redo code")!.label).toBe("review → code · pushback:redo");
    expect(edges.find((e) => e.id === "code conditional:ready ship")!.label).toBe(
      "code → ship · conditional:ready",
    );
  });

  it("drops only the transitions when they are switched off", () => {
    const all = [...edges, ...toDataEdges(channelNodes(model))];
    expect(visibleEdges(all, true)).toHaveLength(all.length);
    const off = visibleEdges(all, false);
    expect(off.every((e) => e.data.kind !== "control")).toBe(true);
    expect(off).toHaveLength(all.length - edges.length);
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

  const views = channelNodes(wired);
  const agents = agentNodes(wired);
  const edges = toDataEdges(views, agents);
  const ch = (name: string) => views.find((v) => v.channel === name)!.id;

  it("routes data through the row: channel → Starter → its agent → channel", () => {
    const pairs = edges.map((e) => `${e.source}→${e.target}`).sort();
    expect(pairs).toEqual(
      [
        // Each Starter dispatches its agent…
        "intake→agent:intake",
        "triage→agent:triage",
        "work→agent:work",
        // …the AGENT publishes, since its runs produced the results…
        `agent:intake→${ch("raw")}`,
        `agent:triage→${ch("triaged")}`,
        // …a publish node, which runs no agent, publishes itself…
        `shout→${ch("raw")}`,
        `orphan→${ch("nobody-reads-this")}`,
        // …and every reader is fed by its channel.
        `${ch("raw")}→triage`,
        `${ch("triaged")}→work`,
        `${ch("inbox")}→intake`,
      ].sort(),
    );
  });

  it("draws a fan-in as ONE junction, not N×M direct edges", () => {
    // Two publishers and one reader of `raw`: three edges through one node.
    // Direct edges would have been two unrelated lines into `triage`.
    const raw = views.find((v) => v.channel === "raw")!;
    expect(raw.publishers).toEqual(["intake", "shout"]);
    expect(raw.readers).toEqual(["triage"]);
    expect(edges.filter((e) => e.data.channel === "raw")).toHaveLength(3);
  });

  it("keeps a channel nothing reads, so a dangling sink is visible", () => {
    // Publishing where nobody listens is legitimate — results parked for a
    // human — but it should be SEEN, not be an invisible absence of an edge.
    const orphan = views.find((v) => v.channel === "nobody-reads-this")!;
    expect(orphan.readers).toEqual([]);
    expect(edges.some((e) => e.source === "orphan")).toBe(true);
  });

  it("keeps a Starter's data on its sides and its control under the row, so they never stack", () => {
    // triage → work exists as a transition AND as data via `triaged` — the
    // case that matters (C1/C9). Data runs through the sides, the transition
    // between the bottom pair.
    const dispatch = edges.find((e) => e.source === "triage")!;
    const into = edges.find((e) => e.target === "work")!;
    const control = toFlowEdges(wired, []).find((e) => e.id === "triage success work")!;
    expect(dispatch.sourceHandle).toBe(HANDLE.dataOut);
    expect(into.targetHandle).toBe(HANDLE.dataIn);
    expect([control.sourceHandle, control.targetHandle]).toEqual([AGENT_HANDLE.control, HANDLE.targetBottom]);
  });

  it("draws a Starter's transitions from its AGENT — the runs hold the outcome, the Starter only dispatches", () => {
    // Regression: `edit → done` was drawn from the Starter itself, a leftover
    // of the design where the Starter ran the agents and collected their
    // output. The edge is still the Starter's transition (id and `from`).
    const control = toFlowEdges(wired, []).find((e) => e.id === "triage success work")!;
    expect(control.source).toBe("agent:triage");
    expect(control.target).toBe("work");
  });

  it("draws a transition that only restates the data path quietly, and a pushback loudly", () => {
    // triage publishes `triaged`, which work reads: the walk's step along it
    // is already on screen as the data row.
    const control = toFlowEdges(wired, []).find((e) => e.id === "triage success work")!;
    expect(control.className).toContain("lb-wf-edge--follows");
    expect(followsData(wired, "triage", "work")).toBe(true);
    // intake → work shares no channel: not a restatement of anything.
    expect(followsData(wired, "intake", "work")).toBe(false);
  });

  it("gives a data edge an id that cannot collide with a transition's", () => {
    const control = toFlowEdges(wired, []).map((e) => e.id);
    for (const e of edges) expect(control).not.toContain(e.id);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });

  it("names the channel on the NODE, not on every edge", () => {
    for (const e of edges) expect(e.label).toBe("");
    // Every edge through a channel knows it; a dispatch touches none.
    const viaChannel = (e: (typeof edges)[number]) => e.source.startsWith("channel:") || e.target.startsWith("channel:");
    for (const e of edges) expect(!!e.data.channel).toBe(viaChannel(e));
  });

  it("marks derived edges undeletable", () => {
    // The way to remove one is to change a channel name in the inspector.
    for (const e of edges) expect(e.deletable).toBe(false);
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
    // Drawn rather than suppressed: a real and usually unintended loop.
    const e = toDataEdges(channelNodes(loop), agentNodes(loop)).map((x) => `${x.source}→${x.target}`);
    expect(e).toEqual(["s→agent:s", "agent:s→channel:q", "channel:q→s"]);
  });
});

describe("measured dimensions — what the MiniMap needs", () => {
  // The bug this covers shipped in P0 and was invisible for weeks: a node
  // sizes itself from CSS, so the GRAPH renders correctly with no dimensions
  // at all. The minimap does not — xyflow's nodeHasDimensions reads
  // `measured.width ?? width ?? initialWidth` and renders NOTHING without one,
  // so the overview was an empty box while every node drew fine.
  //
  // This adapter rebuilds every FlowNode from the model on each render, so
  // anything xyflow measured is discarded unless it is handed back.
  const m = fromDefinition({
    entry: "a",
    states: [
      { state: "a", handler: { kind: "agent", agent: "x" } },
      { state: "b", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "a", to: "b", on: "success" }],
  });

  it("omits `measured` when nothing has been measured yet", () => {
    expect(toFlowNodes(m, [])[0].measured).toBeUndefined();
  });

  it("hands measured dimensions back to xyflow", () => {
    const nodes = toFlowNodes(m, [], null, { a: { width: 170, height: 80 } });
    expect(nodes.find((n) => n.id === "a")!.measured).toEqual({ width: 170, height: 80 });
    // Only the node that was measured — a guessed default for the rest would
    // put wrongly-sized rectangles in the overview.
    expect(nodes.find((n) => n.id === "b")!.measured).toBeUndefined();
  });

  it("returns the SAME map when dimensions are unchanged", () => {
    // Identity, not equality: the map feeds the node array, which xyflow
    // measures, which emits changes. A fresh object each time loops.
    const prev = { a: { width: 170, height: 80 } };
    expect(mergeMeasured(prev, { a: { width: 170, height: 80 } })).toBe(prev);
  });

  it("returns a NEW map when a node resized or a new one appeared", () => {
    const prev = { a: { width: 170, height: 80 } };
    expect(mergeMeasured(prev, { a: { width: 171, height: 80 } })).not.toBe(prev);
    expect(mergeMeasured(prev, { b: { width: 10, height: 10 } })).toEqual({
      a: { width: 170, height: 80 },
      b: { width: 10, height: 10 },
    });
  });
});

describe("hookLabels (RFC DK-P4c)", () => {
  const nodeWith = (handler: Record<string, unknown>) =>
    fromDefinition({ entry: "s", states: [{ state: "s", handler }], transitions: [] }).nodes[0];

  it("labels each hook by event and name, tool hooks first as the runtime chains them", () => {
    const n = nodeWith({
      kind: "agent",
      agent: "a",
      hooks: { agent_stop: ["cite-sources@3"], pre: ["deny-internal-http"] },
      tool_hooks: { WebFetch: { pre: [{ name: "url-gate", url: "https://x.example/hook?token=s3cr3t" }] } },
    });
    expect(hookLabels(n)).toEqual([
      "WebFetch pre: url-gate",
      "agent_stop: cite-sources@3",
      "pre: deny-internal-http",
    ]);
  });

  it("never carries an inline webhook's URL or headers onto the face", () => {
    const n = nodeWith({
      kind: "agent",
      agent: "a",
      hooks: {
        pre: [{ name: "gate", url: "https://x.example/h?token=s3cr3t", headers: { "X-Key": "$cred:k" } }],
      },
    });
    const text = hookLabels(n).join(" ");
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("$cred");
    expect(text).not.toContain("https://");
  });

  it("is empty for a node with no hooks", () => {
    expect(hookLabels(nodeWith({ kind: "agent", agent: "a" }))).toEqual([]);
  });
});

describe("an Input's `publish` — the walk's input, put on a channel (loomcycle #1577)", () => {
  const team = (publish?: string) =>
    fromDefinition({
      entry: "form",
      states: [
        { state: "form", handler: { kind: "input", ...(publish ? { publish: { channel: publish } } : {}) } },
        { state: "research", handler: { kind: "starter", source: { channel: "pcparts-in" }, fanout: { agent: "r", max: 1 } } },
      ],
      transitions: [{ from: "form", to: "research", on: "success" }],
    });

  it("is drawn as an ordinary data edge, Input → channel — it is the definition, not the canvas acting", () => {
    const m = team("pcparts-in");
    const e = toDataEdges(channelNodes(m)).find((x) => x.source === "form");
    expect([e?.target, e?.sourceHandle, e?.className]).toEqual(["channel:pcparts-in", HANDLE.dataOut, "lb-wf-edge lb-wf-edge--data"]);
  });

  it("makes Input → Starter follow that data, so the transition is drawn quietly", () => {
    expect(followsData(team("pcparts-in"), "form", "research")).toBe(true);
  });

  it("draws nothing from an Input that publishes nowhere", () => {
    const m = team();
    expect(toDataEdges(channelNodes(m)).some((x) => x.source === "form")).toBe(false);
    expect(followsData(m, "form", "research")).toBe(false);
  });
});
