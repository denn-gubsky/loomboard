import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parseConnectMessage, readConnectOrigins } from "./connectHandoff";

describe("readConnectOrigins", () => {
  it("returns [] for absent or malformed settings so the receiver stays disabled", () => {
    expect(readConnectOrigins(undefined)).toEqual([]);
    expect(readConnectOrigins(null)).toEqual([]);
    expect(readConnectOrigins({})).toEqual([]);
    expect(readConnectOrigins({ connectOrigins: "https://loomcycle.cloud" })).toEqual([]);
    expect(readConnectOrigins({ connectOrigins: ["", "  "] })).toEqual([]);
  });

  it("keeps the trimmed string origins and drops blanks and non-strings", () => {
    expect(
      readConnectOrigins({
        connectOrigins: [" https://loomcycle.cloud", 42, "", "https://app.example.com "],
      }),
    ).toEqual(["https://loomcycle.cloud", "https://app.example.com"]);
  });

  // public/runtime-config.js ships in every build: the CLI, the desktop app and
  // anything served from dist/. Only a hosting server that writes its own copy
  // may turn the handoff on.
  it("finds no origins in the runtime-config.js every build ships", () => {
    const src = readFileSync(
      new URL("../../public/runtime-config.js", import.meta.url),
      "utf8",
    );
    const window: { __LOOMBOARD_CONFIG__?: unknown } = {};
    runInNewContext(src, { window });
    expect(readConnectOrigins(window.__LOOMBOARD_CONFIG__)).toEqual([]);
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
