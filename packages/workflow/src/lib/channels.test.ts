import { describe, expect, it } from "vitest";
import {
  aclFindings,
  channelAllowed,
  channelRefs,
  channelsInUse,
  grantList,
  requiredACL,
} from "./channels";
import { fromDefinition } from "./model";

const starter = (over: Record<string, unknown> = {}) => ({
  kind: "starter",
  source: { channel: "intake" },
  fanout: { agent: "a", per: "message", max: 4 },
  sink: { channel: "results" },
  ...over,
});

const graph = (channels?: unknown) =>
  fromDefinition({
    entry: "s",
    ...(channels ? { channels } : {}),
    states: [
      { state: "s", handler: starter() },
      { state: "shout", handler: { kind: "channel", channel: "results" } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [
      { from: "s", to: "shout", on: "success" },
      { from: "shout", to: "done", on: "success" },
    ],
  });

describe("channelRefs — what the definition names", () => {
  it("finds a starter's source and sink, and a channel node's target", () => {
    expect(channelRefs(graph())).toEqual([
      { channel: "intake", side: "subscribe", state: "s", field: "source" },
      { channel: "results", side: "publish", state: "s", field: "sink" },
      { channel: "results", side: "publish", state: "shout", field: "channel" },
    ]);
  });

  it("KEEPS duplicates, because each use needs its own grant", () => {
    // The same channel read in one node and written in another needs BOTH
    // sides; collapsing them would hide one and certify a def that cannot run.
    const m = fromDefinition({
      entry: "a",
      states: [
        { state: "a", handler: starter({ sink: { channel: "intake" } }) },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "a", to: "done", on: "success" }],
    });
    const sides = channelRefs(m).filter((r) => r.channel === "intake").map((r) => r.side);
    expect(sides.sort()).toEqual(["publish", "subscribe"]);
  });

  it("ignores an empty channel name", () => {
    const m = fromDefinition({
      entry: "a",
      states: [{ state: "a", handler: starter({ source: { channel: "" } }) }],
      transitions: [],
    });
    expect(channelRefs(m).some((r) => r.field === "source")).toBe(false);
  });
});

describe("channelAllowed — the one matcher, mirrored exactly", () => {
  it("matches an exact name", () => {
    expect(channelAllowed("intake", ["intake"])).toBe(true);
    expect(channelAllowed("intake", ["other"])).toBe(false);
  });

  it("treats a trailing /* as a PREFIX wildcard", () => {
    expect(channelAllowed("findings/alpha", ["findings/*"])).toBe(true);
    // …that does NOT match the bare prefix itself.
    expect(channelAllowed("findings", ["findings/*"])).toBe(false);
    // The case that actually exercises the length guard: `findings/` starts
    // with the prefix and is exactly as long, so only `len(name) > len(prefix)`
    // rejects it. Without that check a bare `findings/` would be granted.
    // Found by mutation — the assertion above passes either way, because
    // "findings" fails startsWith before the length is ever compared.
    expect(channelAllowed("findings/", ["findings/*"])).toBe(false);
  });

  it("refuses a traversal name before any wildcard match", () => {
    // Defence-in-depth, and the reason a mirror must not simplify: without it
    // a `findings/*` grant would cover `findings/../secret`, and the canvas
    // would show green for an ACL the runtime rejects.
    expect(channelAllowed("findings/../secret", ["findings/*"])).toBe(false);
    expect(channelAllowed("findings//bypass", ["findings/*"])).toBe(false);
  });

  it("trims the pattern and the name", () => {
    expect(channelAllowed(" intake ", [" intake "])).toBe(true);
  });

  it("refuses everything against an empty allowlist", () => {
    expect(channelAllowed("intake", [])).toBe(false);
  });
});

describe("aclFindings — the check that blocks a save", () => {
  it("flags every ungranted use when the team declares no ACL", () => {
    const f = aclFindings(graph());
    expect(f).toHaveLength(3);
    expect(f.every((x) => x.level === "error")).toBe(true);
    expect(f[0].message).toMatch(/declares\s+no channel ACL at all/);
    // Prefixed with the node, like every other finding in the same list.
    expect(f[0].message).toMatch(/^state "s" uses channel "intake" as its source/);
  });

  it("names the node that broke, not the graph", () => {
    const f = aclFindings(graph());
    expect(f.map((x) => x.nodeId)).toEqual(["s", "s", "shout"]);
  });

  it("is silent once both sides are granted", () => {
    expect(aclFindings(graph({ subscribe: ["intake"], publish: ["results"] }))).toEqual([]);
  });

  it("still flags the side that is missing", () => {
    // Subscribe granted, publish not — the commonest half-done ACL.
    const f = aclFindings(graph({ subscribe: ["intake"] }));
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.message.includes("publish"))).toBe(true);
  });

  it("honours a wildcard grant", () => {
    const m = fromDefinition({
      entry: "a",
      states: [
        { state: "a", handler: starter({ source: { channel: "team/in" }, sink: { channel: "team/out" } }) },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "a", to: "done", on: "success" }],
      channels: { subscribe: ["team/*"], publish: ["team/*"] },
    });
    expect(aclFindings(m)).toEqual([]);
  });

  it("reads the operator's pending ACL edit, not just the saved one", () => {
    // The panel edits `channelsPatch`; findings that ignored it would keep
    // showing an error the operator has already fixed on screen.
    const m = { ...graph(), channelsPatch: { subscribe: ["intake"], publish: ["results"] } };
    expect(aclFindings(m)).toEqual([]);
  });
});

describe("requiredACL / channelsInUse", () => {
  it("offers the exact block the definition needs, sorted", () => {
    expect(requiredACL(graph())).toEqual({ publish: ["results"], subscribe: ["intake"] });
  });

  it("lists each channel once with the sides it needs", () => {
    expect(channelsInUse(graph())).toEqual([
      { channel: "intake", sides: ["subscribe"] },
      { channel: "results", sides: ["publish"] },
    ]);
  });

  it("reports a channel used on both sides once, with both", () => {
    const m = fromDefinition({
      entry: "a",
      states: [{ state: "a", handler: starter({ sink: { channel: "intake" } }) }],
      transitions: [],
    });
    expect(channelsInUse(m)).toEqual([{ channel: "intake", sides: ["publish", "subscribe"] }]);
  });
});

describe("grantList", () => {
  it("reads the saved ACL", () => {
    expect(grantList(graph({ subscribe: ["x"] }), "subscribe")).toEqual(["x"]);
  });

  it("returns [] for a team with no ACL", () => {
    expect(grantList(graph(), "publish")).toEqual([]);
  });
});

describe("aclFindings — opaque nodes", () => {
  it("does not ACL-check a kind this build cannot render", () => {
    // Consistent with the runtime, not softer than it: Go refuses an unknown
    // kind in teamgraph.Validate, which runs BEFORE the tool's channel
    // preflight — so it never reaches the ACL check either. Flagging one here
    // would paint a graph red that a newer runtime accepts (decision 3).
    const m = fromDefinition({
      entry: "a",
      states: [
        { state: "a", handler: { kind: "from-a-newer-runtime", source: { channel: "x" } } },
        { state: "done", handler: { kind: "terminal" } },
      ],
      transitions: [{ from: "a", to: "done", on: "success" }],
    });
    expect(m.nodes[0].opaque).toBe(true);
    expect(aclFindings(m)).toEqual([]);
    // …but the reference itself is still enumerated, because channelRefs is
    // the faithful mirror and the finding policy is the canvas's.
    expect(channelRefs(m)).toHaveLength(1);
  });
});
