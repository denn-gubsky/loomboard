import { describe, expect, it } from "vitest";
import { parseConnectMessage, parseConnectOrigins } from "./connectHandoff";

describe("parseConnectOrigins", () => {
  it("returns [] for unset/empty so the receiver stays disabled by default", () => {
    expect(parseConnectOrigins(undefined)).toEqual([]);
    expect(parseConnectOrigins("")).toEqual([]);
    expect(parseConnectOrigins("  ,  ,")).toEqual([]);
  });

  it("splits, trims, and drops blanks", () => {
    expect(
      parseConnectOrigins("https://loomcycle.cloud, https://app.example.com ,"),
    ).toEqual(["https://loomcycle.cloud", "https://app.example.com"]);
  });
});

describe("parseConnectMessage", () => {
  const allow = ["https://loomcycle.cloud"];
  const msg = { type: "loomboard.connect", baseUrl: "", token: "lc_abc" };

  it("accepts a well-formed message from an allowlisted origin", () => {
    expect(parseConnectMessage(allow, "https://loomcycle.cloud", msg)).toEqual({
      baseUrl: "",
      token: "lc_abc",
    });
  });

  it("defaults baseUrl to '' when absent (same-origin proxy)", () => {
    expect(
      parseConnectMessage(allow, "https://loomcycle.cloud", {
        type: "loomboard.connect",
        token: "lc_abc",
      }),
    ).toEqual({ baseUrl: "", token: "lc_abc" });
  });

  it("passes through an explicit baseUrl", () => {
    expect(
      parseConnectMessage(allow, "https://loomcycle.cloud", {
        type: "loomboard.connect",
        baseUrl: "https://app.loomcycle.cloud",
        token: "lc_abc",
      }),
    ).toEqual({ baseUrl: "https://app.loomcycle.cloud", token: "lc_abc" });
  });

  it("rejects an origin that is not allowlisted", () => {
    expect(parseConnectMessage(allow, "https://evil.example", msg)).toBeNull();
  });

  it("rejects everything when the allowlist is empty", () => {
    expect(parseConnectMessage([], "https://loomcycle.cloud", msg)).toBeNull();
  });

  it("rejects the wrong message type", () => {
    expect(
      parseConnectMessage(allow, "https://loomcycle.cloud", {
        type: "something.else",
        token: "lc_abc",
      }),
    ).toBeNull();
  });

  it("rejects a missing or non-string token", () => {
    expect(
      parseConnectMessage(allow, "https://loomcycle.cloud", {
        type: "loomboard.connect",
      }),
    ).toBeNull();
    expect(
      parseConnectMessage(allow, "https://loomcycle.cloud", {
        type: "loomboard.connect",
        token: 123,
      }),
    ).toBeNull();
  });

  it("rejects null / non-object payloads", () => {
    expect(parseConnectMessage(allow, "https://loomcycle.cloud", null)).toBeNull();
    expect(
      parseConnectMessage(allow, "https://loomcycle.cloud", "lc_abc"),
    ).toBeNull();
  });
});
