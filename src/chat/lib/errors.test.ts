import { describe, it, expect } from "vitest";
import { LoomcycleError } from "@loomcycle/client";
import { describeError, friendlyFromBody } from "./errors";

describe("friendlyFromBody", () => {
  it("returns the server's message from a JSON error body", () => {
    const body =
      '{"code":"token_limit_exceeded","error":"x","message":"tenant acme hard token budget reached: 1200000 of 1000000 tokens this month"}';
    expect(friendlyFromBody(body)).toBe(
      "tenant acme hard token budget reached: 1200000 of 1000000 tokens this month",
    );
  });

  it("falls back to `error` when `message` is absent", () => {
    expect(
      friendlyFromBody('{"code":"operator_key_restricted","error":"bring your own provider key"}'),
    ).toBe("bring your own provider key");
  });

  it("returns null for absent, empty, non-JSON, or messageless bodies", () => {
    expect(friendlyFromBody(undefined)).toBeNull();
    expect(friendlyFromBody("")).toBeNull();
    expect(friendlyFromBody("Too Many Requests")).toBeNull();
    expect(friendlyFromBody("{}")).toBeNull();
  });
});

describe("describeError", () => {
  it("prefers the body message over the generic SDK class message (hard token budget)", () => {
    // 429 token_limit_exceeded maps to a generic BackpressureError-style message
    // in the SDK; the specific banner survives in bodyText.
    const e = new LoomcycleError("Too Many Requests", {
      status: 429,
      bodyText:
        '{"code":"token_limit_exceeded","message":"tenant acme hard token budget reached: 1200000 of 1000000 tokens this month"}',
    });
    expect(describeError(e)).toContain("hard token budget reached");
  });

  it("surfaces the missing-provider-key guidance (403)", () => {
    const e = new LoomcycleError("Forbidden", {
      status: 403,
      bodyText:
        '{"code":"operator_key_restricted","error":"this principal may not use the operator\'s provider API keys; bring your own provider key"}',
    });
    expect(describeError(e)).toContain("bring your own provider key");
  });

  it("falls back to the SDK message when the body carries no message", () => {
    const e = new LoomcycleError("unauthorized (401)", { status: 401, bodyText: "" });
    expect(describeError(e)).toBe("unauthorized (401)");
  });

  it("surfaces a bare string rejection (Tauri plugin-http scope/TLS errors)", () => {
    // The native fetch rejects with a plain string, not an Error — it must not
    // be swallowed as "Unknown error".
    expect(
      describeError(
        "url not allowed on the configured scope: https://box:8788/v1/_me",
      ),
    ).toContain("not allowed on the configured scope");
  });

  it("extracts .message from a non-Error object rejection", () => {
    expect(describeError({ message: "connection refused" })).toBe(
      "connection refused",
    );
  });

  it("returns Unknown error only for truly opaque values", () => {
    expect(describeError(null)).toBe("Unknown error");
    expect(describeError(42)).toBe("Unknown error");
    expect(describeError("")).toBe("Unknown error");
  });
});

describe("describeError — access-rule refusals (loomcycle 1.122+)", () => {
  // The 403 body loomcycle writes (internal/api/http/acl_gate.go aclDeniedReply).
  const denied = (reasons: unknown[]) =>
    JSON.stringify({
      code: "acl_denied",
      error: "run agent:researcher is denied by ops rule 2",
      action: "run",
      resource: "agent:researcher",
      reasons,
    });

  it("names the action, the resource and the deny rules that decided", () => {
    const e = new LoomcycleError("Forbidden", {
      status: 403,
      bodyText: denied([
        { acl: "ops", version: 3, rule: 2, effect: "deny" },
        { acl: "builtin:tenant-member", rule: 0, effect: "allow" },
      ]),
    });
    expect(describeError(e)).toBe(
      'Access denied: you may not run agent:researcher — denied by list "ops" v3 rule 2.',
    );
  });

  it("reads the fields an AclDeniedError carries, before the body", () => {
    const e = Object.assign(new LoomcycleError("Forbidden", { status: 403, code: "acl_denied" }), {
      action: "read",
      resource: "document:/plans/x",
      reasons: [{ acl: "readers", rule: 0, effect: "deny" }],
    });
    expect(describeError(e)).toBe('Access denied: you may not read document:/plans/x — denied by list "readers" rule 0.');
  });

  it("says no rule allows it when no rule denied", () => {
    const e = new LoomcycleError("Forbidden", { status: 403, bodyText: denied([]) });
    expect(describeError(e)).toBe("Access denied: you may not run agent:researcher — no access rule allows it.");
  });

  it("asks for a retry when the rules could not be read", () => {
    const e = new LoomcycleError("Service Unavailable", {
      status: 503,
      bodyText: JSON.stringify({ code: "acl_unavailable", error: "access control is unavailable" }),
    });
    expect(describeError(e)).toBe("Access rules could not be read right now — try again in a moment.");
  });

  it("keeps the server's reason for a refused self-elevation", () => {
    const e = new LoomcycleError("Forbidden", {
      status: 403,
      bodyText: JSON.stringify({ code: "acl_self_elevation", error: "refused: the list is bound to you" }),
    });
    expect(describeError(e)).toBe("Refused — the list is bound to you");
  });

  it("leaves every other error to the server's own message", () => {
    const e = new LoomcycleError("Forbidden", {
      status: 403,
      bodyText: JSON.stringify({ code: "insufficient_scope", error: "needs substrate:tenant" }),
    });
    expect(describeError(e)).toBe("needs substrate:tenant");
  });
});
