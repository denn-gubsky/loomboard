import { describe, expect, it } from "vitest";
import { LoomcycleError, OAuthError } from "@loomcycle/client";
import { transientFailure } from "./signInLifecycle";

describe("transientFailure", () => {
  it("is true for an unanswered request or a failing server, which say nothing about the sign-in", () => {
    expect(transientFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(transientFailure("error sending request for url")).toBe(true); // the desktop's native transport
    expect(transientFailure(new LoomcycleError("down", { status: 503 }))).toBe(true);
    expect(transientFailure(new LoomcycleError("slow down", { status: 429 }))).toBe(true);
    expect(transientFailure(new OAuthError("temporarily_unavailable", { status: 503 }))).toBe(true);
  });

  it("is false for an answer about the sign-in itself", () => {
    expect(transientFailure(new LoomcycleError("unauthenticated", { status: 401 }))).toBe(false);
    expect(transientFailure(new LoomcycleError("forbidden", { status: 403 }))).toBe(false);
    expect(transientFailure(new OAuthError("invalid_grant", { status: 400 }))).toBe(false);
    expect(transientFailure(new Error("something else"))).toBe(false);
  });
});
