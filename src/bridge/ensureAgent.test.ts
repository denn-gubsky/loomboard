import { afterEach, describe, expect, it, vi } from "vitest";
import { LoomcycleError, type LoomcycleClient } from "@loomcycle/client";
import { agentSetupNotice, ensureChromeAssistant } from "./ensureAgent";
import { bridgeBlockedBy } from "./status";

type Op = (req: { op: string }) => Promise<unknown>;

function client(get: Op, create: Op = async () => ({})) {
  const agentDef = vi.fn((req: { op: string }) => (req.op === "get" ? get(req) : create(req)));
  return { c: { agentDef } as unknown as LoomcycleClient, agentDef };
}

const fail = (status: number, code?: string) => async () => {
  throw new LoomcycleError(`status ${status}`, { status, code });
};

afterEach(() => vi.restoreAllMocks());

describe("ensureChromeAssistant", () => {
  it("reports an existing agent and never writes to it", async () => {
    const { c, agentDef } = client(async () => ({ name: "chrome-assistant" }));
    expect(await ensureChromeAssistant(c)).toEqual({ kind: "exists" });
    expect(agentDef).toHaveBeenCalledTimes(1);
  });

  it("creates the agent only when the lookup says it is absent", async () => {
    const { c, agentDef } = client(fail(404));
    expect(await ensureChromeAssistant(c)).toEqual({ kind: "created" });
    expect(agentDef.mock.calls.map(([r]) => r.op)).toEqual(["get", "create"]);
  });

  it("reports a refused create with the rule's code instead of throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { c } = client(fail(404), fail(403, "acl_denied"));
    expect(await ensureChromeAssistant(c)).toEqual({ kind: "refused", code: "acl_denied" });
  });

  it("reports a refused lookup as refused, and does not try to create", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { c, agentDef } = client(fail(403));
    expect(await ensureChromeAssistant(c)).toEqual({ kind: "refused" });
    expect(agentDef).toHaveBeenCalledTimes(1);
  });

  it("reports a failing server as unknown, not as a refusal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await ensureChromeAssistant(client(fail(503)).c)).toEqual({ kind: "unknown" });
    expect(await ensureChromeAssistant(client(fail(404), fail(500)).c)).toEqual({ kind: "unknown" });
  });
});

describe("agentSetupNotice", () => {
  it("names access rules for acl_denied and the sign-in otherwise, and what to ask the operator", () => {
    const acl = agentSetupNotice({ kind: "refused", code: "acl_denied" })!;
    expect(acl).toContain("your access rules don't");
    expect(acl).toContain("ask your operator to create chrome-assistant");
    expect(agentSetupNotice({ kind: "refused", code: "insufficient_scope" })).toContain("your sign-in doesn't");
  });

  it("says nothing when the agent exists, was created, or nothing is known", () => {
    expect(agentSetupNotice({ kind: "exists" })).toBeNull();
    expect(agentSetupNotice({ kind: "created" })).toBeNull();
    expect(agentSetupNotice({ kind: "unknown" })).toBeNull();
  });
});

describe("bridgeBlockedBy", () => {
  it("blocks the browser tools under strict sign-in, naming G34, and nowhere else", () => {
    expect(bridgeBlockedBy("strict")).toMatch(/strict sign-in.*G34/);
    expect(bridgeBlockedBy("token")).toBeNull();
    expect(bridgeBlockedBy("open")).toBeNull();
    expect(bridgeBlockedBy(undefined)).toBeNull();
  });
});
