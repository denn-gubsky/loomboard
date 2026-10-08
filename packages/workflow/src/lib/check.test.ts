import { describe, expect, it } from "vitest";
import { checkFindings, checkSummary, issueFinding, parseIssuePath, unlistedIssues } from "./check";
import type { Finding } from "./validate";
import type { TeamCheck } from "../types";

describe("parseIssuePath", () => {
  it("reads the paths the runtime writes", () => {
    expect(parseIssuePath("states[2].handler.sink.channel")).toEqual(["states", 2, "handler", "sink", "channel"]);
    expect(parseIssuePath("local.agents.reviewer")).toEqual(["local", "agents", "reviewer"]);
    expect(parseIssuePath("channels.publish[1]")).toEqual(["channels", "publish", 1]);
    expect(parseIssuePath("transitions[3].on")).toEqual(["transitions", 3, "on"]);
  });

  it("reads a key written as a bracketed JSON string, escapes included", () => {
    expect(parseIssuePath('vars["has space"]')).toEqual(["vars", "has space"]);
    expect(parseIssuePath('local.agents["a.b"].tools[0]')).toEqual(["local", "agents", "a.b", "tools", 0]);
    expect(parseIssuePath('vars["say \\"hi\\"]"]')).toEqual(["vars", 'say "hi"]']);
  });

  it("stops at what it cannot read, keeping the enclosing path", () => {
    expect(parseIssuePath("states[x].handler")).toEqual(["states"]);
    expect(parseIssuePath('vars["open')).toEqual(["vars"]);
    expect(parseIssuePath("states[1]!bad")).toEqual(["states", 1]);
    expect(parseIssuePath("")).toEqual([]);
  });
});

describe("issueFinding", () => {
  it("places a refusal on its state and its path, without the server's prefix", () => {
    expect(
      issueFinding({
        kind: "local_channel_missing",
        severity: "refused",
        detail: 'team definition: state "orphan" channel: "./missing" names a channel the team does not declare',
        path: "states[2].handler.channel",
        state: "orphan",
      }),
    ).toEqual({
      level: "error",
      message: 'state "orphan" channel: "./missing" names a channel the team does not declare',
      nodeId: "orphan",
      path: ["states", 2, "handler", "channel"],
    });
  });

  it("says an unrunnable problem would still be saved, and makes an advisory one a note", () => {
    const f = issueFinding({ kind: "agent_missing", severity: "unrunnable", detail: 'agent "x" does not resolve in this tenant' });
    expect(f).toEqual({ level: "error", message: 'agent "x" does not resolve in this tenant (it would be saved, but could not run)' });
    expect(issueFinding({ kind: "local_agent_unreferenced", severity: "advisory", detail: "unused" }).level).toBe("info");
  });
});

describe("checkSummary", () => {
  const issue = (severity: string) => ({ kind: "k", severity, detail: "d" });

  it("says a save would be refused, counting the refusals", () => {
    const c: TeamCheck = { valid: false, runnable: false, issues: [issue("refused"), issue("refused"), issue("unrunnable")] };
    expect(checkSummary(c)).toEqual({ tone: "error", text: "The runtime would refuse this save: 2 problems." });
  });

  it("says a team that would save could not run", () => {
    const c: TeamCheck = { valid: true, runnable: false, issues: [issue("unrunnable")] };
    expect(checkSummary(c)).toEqual({ tone: "warn", text: "The runtime would save this, but a walk could not run it: 1 problem." });
  });

  it("says a clean team is accepted, and mentions notes", () => {
    expect(checkSummary({ valid: true, runnable: true, issues: [] })).toEqual({
      tone: "ok",
      text: "The runtime accepts this team, and a walk could run it.",
    });
    expect(checkSummary({ valid: true, runnable: true, issues: [issue("advisory")] }).text).toMatch(/1 note\.$/);
    expect(checkFindings({ valid: true })).toEqual([]);
  });
});

describe("unlistedIssues — what the runtime found that the canvas has not already listed", () => {
  // The answer TrueNAS gave for a draft with a missing own channel, a bad
  // transition label and an agent that does not exist (2026-10-08).
  const check: TeamCheck = {
    valid: false,
    runnable: false,
    issues: [
      {
        kind: "local_channel_missing",
        severity: "refused",
        detail: 'team definition: state "note" channel: "./missing" names a channel the team does not declare under local.channels (it declares none)',
        path: "states[2].handler.channel",
        state: "note",
      },
      { kind: "graph_invalid", severity: "refused", detail: 'team definition: transition[1] has invalid `on` "failure" (want success | pushback:<reason> | conditional:<expr>)', path: "transitions[1].on" },
      { kind: "agent_missing", severity: "unrunnable", detail: 'agent "loomboard/no-such-agent" does not resolve in this tenant', path: "states[0].handler.agent", state: "write" },
    ],
  };
  const own: Finding[] = [
    { level: "error", nodeId: "note", message: 'state "note" channel: "./missing" names a channel the team does not declare under local.channels (it declares none)' },
    { level: "error", edgeIndex: 1, message: 'transition[1] invalid `on` "failure" (want success | pushback:<reason> | conditional:<expr>)' },
  ];

  it("leaves only what the canvas could not know, and counts the rest", () => {
    const r = unlistedIssues(check, own);
    expect(r.alsoListed).toBe(2);
    expect(r.findings.map((f) => f.message)).toEqual(['agent "loomboard/no-such-agent" does not resolve in this tenant (it would be saved, but could not run)']);
  });

  it("shows everything when the canvas has listed nothing", () => {
    expect(unlistedIssues(check, [])).toMatchObject({ alsoListed: 0, findings: { length: 3 } });
  });

  it("still shows a second graph error on a state the canvas found only one on", () => {
    const two: TeamCheck = {
      valid: false,
      issues: [
        { kind: "graph_invalid", severity: "refused", detail: 'state "orphan" is unreachable from entry "write"', path: "states[2]", state: "orphan" },
        { kind: "graph_invalid", severity: "refused", detail: 'non-terminal state "orphan" has no outbound transition (dead end)', path: "states[2]", state: "orphan" },
      ],
    };
    const r = unlistedIssues(two, [{ level: "error", nodeId: "orphan", message: "worded differently" }]);
    expect(r.alsoListed).toBe(1);
    expect(r.findings).toHaveLength(1);
  });

  it("never takes a non-graph issue as listed just because the canvas has a finding on that state", () => {
    const c: TeamCheck = { valid: true, runnable: false, issues: [{ kind: "agent_missing", severity: "unrunnable", detail: "no such agent", state: "write" }] };
    expect(unlistedIssues(c, [{ level: "error", nodeId: "write", message: "something else is wrong here" }]).alsoListed).toBe(0);
    const acl: TeamCheck = { valid: false, issues: [{ kind: "channel_authority", severity: "refused", detail: "you may not grant ops", state: "write" }] };
    expect(unlistedIssues(acl, [{ level: "error", nodeId: "write", message: "something else" }]).alsoListed).toBe(0);
  });
});

