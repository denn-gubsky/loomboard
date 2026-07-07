import { describe, it, expect } from "vitest";
import type { ClientToolInvocation } from "@loomcycle/client";
import { toCommand, toOutput } from "./clientToolHost";
import type { BrowserResult } from "./protocol";

function inv(tool: string, input: unknown): ClientToolInvocation {
  return { tool, input, callId: "call-1" };
}

describe("toCommand", () => {
  it("maps a client__browser tool to its op and carries the call id as the internal id", () => {
    const cmd = toCommand(inv("browser_read_page", {}));
    expect(cmd).toEqual({
      id: "call-1",
      op: "read_page",
      ref: undefined,
      value: undefined,
      url: undefined,
      reason: undefined,
    });
  });

  it("threads string inputs (ref/value/reason) onto the command", () => {
    const cmd = toCommand(inv("browser_fill", { ref: "e3", value: "hi", reason: "why" }));
    expect(cmd).toMatchObject({ op: "fill", ref: "e3", value: "hi", reason: "why" });
  });

  it("returns null for a tool we never registered", () => {
    expect(toCommand(inv("browser_eval", { code: "x" }))).toBeNull();
    expect(toCommand(inv("fs_read", {}))).toBeNull();
  });

  it("coerces non-string input fields to undefined (never trusts the shape)", () => {
    const cmd = toCommand(inv("browser_fill", { ref: 42, value: null, reason: {} }));
    expect(cmd).toMatchObject({ op: "fill", ref: undefined, value: undefined, reason: undefined });
  });

  it("tolerates a missing/non-object input", () => {
    expect(toCommand(inv("browser_get_selection", undefined))).toMatchObject({
      op: "get_selection",
    });
  });
});

describe("toOutput", () => {
  it("drops the internal id and keeps only present fields", () => {
    const res: BrowserResult = {
      id: "call-1",
      ok: true,
      op: "read_page",
      snapshot: { url: "u", title: "t", refs: [], text: "x" },
    };
    const out = toOutput(res);
    expect(out).toEqual({
      ok: true,
      op: "read_page",
      snapshot: { url: "u", title: "t", refs: [], text: "x" },
    });
    expect("id" in out).toBe(false);
  });

  it("preserves a declined status + error so the agent can tell it apart from a failure", () => {
    const res: BrowserResult = {
      id: "call-1",
      ok: false,
      op: "click",
      status: "declined",
      error: "declined by user",
    };
    expect(toOutput(res)).toEqual({
      ok: false,
      op: "click",
      status: "declined",
      error: "declined by user",
    });
  });

  it("keeps the snapshot on a stale_ref error so the agent can retry against fresh refs", () => {
    const res: BrowserResult = {
      id: "call-1",
      ok: false,
      op: "fill",
      error: "stale_ref",
      snapshot: { url: "u", title: "t", refs: [], text: "" },
    };
    const out = toOutput(res);
    expect(out.error).toBe("stale_ref");
    expect(out.snapshot).toBeDefined();
  });
});
