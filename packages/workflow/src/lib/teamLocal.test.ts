import { describe, expect, it } from "vitest";
import { aclFindings } from "./channels";
import { channelNodes } from "./channelNodes";
import { fromDefinition, toDefinition } from "./model";
import { localNames, localRef, teamOwnEntries, teamVars, varValueError } from "./teamLocal";

const team = (extra: Record<string, unknown> = {}) =>
  fromDefinition({
    entry: "research",
    states: [
      { state: "research", handler: { kind: "starter", source: { channel: "./in" }, fanout: { agent: "./researcher", max: 1 }, sink: { channel: "./out" } } },
      { state: "done", handler: { kind: "terminal" } },
    ],
    transitions: [{ from: "research", to: "done", on: "success" }],
    vars: { tone: "formal", audience: "" },
    local: {
      agents: { researcher: { tier: "low", system_prompt: "Research." } },
      channels: { in: { scope: "tenant" }, out: { scope: "tenant" } },
    },
    ...extra,
  });

describe("a team's own definitions (RFC DV)", () => {
  it("reads the declared variables and local names", () => {
    expect(teamVars(team())).toEqual({ tone: "formal", audience: "" });
    expect(localNames(team(), "channels")).toEqual(["in", "out"]);
    expect(localRef("./in")).toBe("in");
    expect(localRef("in")).toBeUndefined();
  });

  it("asks no ACL grant for the team's own channels — the team may always use them", () => {
    // Regression: the canvas demanded `channels.publish/subscribe` entries the
    // runtime never asks for (and refuses), which blocked the save.
    expect(aclFindings(team())).toEqual([]);
  });

  it("draws the team's own channel as declared and granted, though no listing shows it", () => {
    const views = channelNodes(team(), [{ name: "global-only", scope: "tenant" }]);
    expect(views.map((v) => [v.channel, v.declared, v.grants])).toEqual([
      ["./in", true, { subscribe: true }],
      ["./out", true, { publish: true }],
    ]);
  });

  it("keeps vars and local untouched through a save", () => {
    const d = toDefinition(team());
    expect(d.vars).toEqual({ tone: "formal", audience: "" });
    expect(d.local).toEqual(team().source.local);
  });

  it("checks a variable's value as the runtime does", () => {
    expect(varValueError("warm")).toBeUndefined();
    expect(varValueError("")).toBeUndefined();
    expect(varValueError("{{memory:core_blocks}}")).toMatch(/placeholder/);
    expect(varValueError("${run.user_bearer}")).toMatch(/credentials/);
    expect(varValueError("é".repeat(2049))).toMatch(/4098 bytes/);
  });
});

describe("teamOwnEntries", () => {
  const own = fromDefinition({
    entry: "w",
    states: [{ state: "w", handler: { kind: "agent", agent: "./writer" } }],
    transitions: [],
    local: {
      agents: { writer: { provider: "ollama-local", model: "ornith-1.5:35b", tools: [], skills: ["./style"] } },
      skills: { style: { body: "Write plainly.", description: "House style" } },
      channels: { notes: { scope: "user" } },
      schedules: { tick: { schedule: "@hourly", channel: "./notes" } },
      webhooks: { hook: { auth: { kind: "bearer", bearer_token_env: "HOOK_TOKEN" }, channel: "./notes" } },
    },
  });

  it("lists each kind with what an operator reads it for", () => {
    const e = teamOwnEntries(own, "blog");
    expect(e.map((x) => [x.kind, x.ref])).toEqual([
      ["agents", "./writer"],
      ["skills", "./style"],
      ["channels", "./notes"],
      ["schedules", "./tick"],
      ["webhooks", "./hook"],
    ]);
    expect(e[0].facts).toEqual(["ollama-local/ornith-1.5:35b", "no tools", "skills: ./style", "runs as blog/writer"]);
    expect(e[2].facts).toEqual(["scope user"]);
    // A webhook names env vars only, and says when it answers.
    expect(e[4].facts).toEqual(["POST /v1/_teams/{tenant}/blog/webhooks/hook", "→ ./notes", "auth bearer (HOOK_TOKEN)"]);
    expect(e[4].note).toMatch(/only while a walk/);
  });

  it("says when a team's own agent takes over a global agent's name inside its walks", () => {
    expect(teamOwnEntries(own, "blog", ["writer"])[0].note).toMatch(/runs this one/);
    expect(teamOwnEntries(own, "blog", ["editor"])[0].note).toBeUndefined();
  });
});
