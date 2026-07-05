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
