import { describe, expect, it } from "vitest";
import type { AuthzDecision, WhoamiResponse } from "@loomcycle/client";
import { bindingLine, connectionFacts, decidingReasons, modeNote, outcomeNote, selfQuestion } from "./myAccess";

function who(p: Partial<WhoamiResponse>): WhoamiResponse {
  return { tenant_id: "acme", subject: "ada", scopes: [], is_admin: false, legacy: false, ...p };
}

const labels = (p: WhoamiResponse, signedIn = false) => connectionFacts(p, signedIn).map((f) => f.label);
const value = (p: WhoamiResponse, label: string, signedIn = false) =>
  connectionFacts(p, signedIn).find((f) => f.label === label)?.value;

describe("connectionFacts", () => {
  it("lists only what the server sent", () => {
    expect(labels(who({}))).toEqual(["Subject", "Tenant", "Connected with"]);
    expect(value(who({}), "Connected with")).toBe("A token");
    expect(value(who({}), "Connected with", true)).toBe("Sign in with loomcycle");
    expect(value(who({ open_mode: true, tenant_id: "" }), "Tenant")).toBe("default");
  });

  it("names the sign-in, its session and a pending approval", () => {
    const p = who({
      auth: { mode: "strict", gate: "github", amr: ["oauth"], auth_time: "2026-10-29T10:00:00Z", status: "pending" },
    });
    expect(labels(p)).toEqual(["Subject", "Tenant", "Connected with", "Sign-in option", "Methods", "Signed in", "Status"]);
    expect(value(p, "Status")).toBe("Waiting for an operator's approval");
  });

  it("states what narrows the token", () => {
    const p = who({ restrictions: { agents: ["chat/a", "chat/b"], overrides: "none", rate: { per_minute: 6, burst: 2 }, retention: "none" } });
    expect(value(p, "Limited to agents")).toBe("chat/a, chat/b");
    expect(value(p, "Run settings you may change")).toBe("none");
    expect(value(p, "Run starts")).toBe("at most 6 a minute, 2 at once");
    expect(value(p, "Run history")).toBe("not kept for runs this token starts");
  });
});

describe("modeNote", () => {
  it("says who decides in each mode", () => {
    expect(modeNote("enforce")).toMatch(/refused/);
    expect(modeNote("shadow")).toMatch(/scopes decide/);
    expect(modeNote("compat")).toMatch(/scopes decide/);
    expect(modeNote(undefined)).toBe("This loomcycle has no access rules.");
  });
});

describe("selfQuestion", () => {
  it("asks about the caller, with a blank name meaning any instance", () => {
    expect(selfQuestion(" run ", "agent", "")).toEqual({ action: { name: "run" }, resource: { type: "agent", id: "" } });
    expect(selfQuestion("invoke", "tool", " Bash ")?.resource.id).toBe("Bash");
    expect(selfQuestion("run", "agent", "x")).not.toHaveProperty("subject");
  });

  it("is not a question without an action and a type", () => {
    expect(selfQuestion("", "agent", "x")).toBeNull();
    expect(selfQuestion("run", " ", "x")).toBeNull();
  });
});

describe("decidingReasons / outcomeNote", () => {
  const deny: AuthzDecision = {
    decision: false,
    outcome: "deny",
    mode: "enforce",
    reasons: [
      { acl: "base", rule: 0, effect: "allow" },
      { acl: "interns", version: 3, rule: 1, effect: "deny" },
    ],
  };

  it("keeps the rules that made the outcome, not the allows a deny overrode", () => {
    expect(decidingReasons(deny)).toEqual([{ acl: "interns", version: 3, rule: 1, effect: "deny" }]);
  });

  it("explains each outcome", () => {
    expect(outcomeNote(deny)).toBe("A rule denies it; a deny beats every allow.");
    expect(outcomeNote({ decision: true, outcome: "allow", mode: "enforce" })).toBe("A rule allows it and no rule denies it.");
    expect(outcomeNote({ decision: false, outcome: "no_match", mode: "enforce" })).toMatch(/that is a refusal/);
    expect(outcomeNote({ decision: true, outcome: "no_match", mode: "compat" })).toMatch(/in compat mode your token's scopes decide/);
    expect(outcomeNote({ decision: false, outcome: "deny", mode: "enforce", tenant_floor: true })).toMatch(/tenant floor/);
  });
});

describe("bindingLine", () => {
  it("names the list and what it is bound through", () => {
    expect(bindingLine({ acl: "ops", subject_kind: "group", subject_id: "eng" })).toBe('"ops" → group eng');
    expect(bindingLine({ acl: "base", subject_kind: "tenant" })).toBe('"base" → tenant');
  });
});
