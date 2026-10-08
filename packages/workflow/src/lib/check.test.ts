import { describe, expect, it } from "vitest";
import { checkFindings, checkSummary, issueFinding, parseIssuePath } from "./check";
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
