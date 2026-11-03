import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { readRuntimeBaseUrl } from "./runtimeConfig";

describe("readRuntimeBaseUrl", () => {
  it("returns the bare origin a hosting server offers", () => {
    expect(readRuntimeBaseUrl({ connectOrigins: [], baseUrl: "https://loomcycle.example" })).toBe(
      "https://loomcycle.example",
    );
    expect(readRuntimeBaseUrl({ baseUrl: "http://127.0.0.1:8791" })).toBe("http://127.0.0.1:8791");
  });

  it("returns null when the config offers none", () => {
    expect(readRuntimeBaseUrl(undefined)).toBeNull();
    expect(readRuntimeBaseUrl(null)).toBeNull();
    expect(readRuntimeBaseUrl({ connectOrigins: [] })).toBeNull();
    expect(readRuntimeBaseUrl({ baseUrl: 42 })).toBeNull();
  });

  // The issuer check compares against this address, so these would make every
  // sign-in fail rather than help it.
  it("ignores a value that is not a bare http(s) origin", () => {
    expect(readRuntimeBaseUrl({ baseUrl: "https://loomcycle.example/" })).toBeNull();
    expect(readRuntimeBaseUrl({ baseUrl: "https://loomcycle.example/v1" })).toBeNull();
    expect(readRuntimeBaseUrl({ baseUrl: "loomcycle.example" })).toBeNull();
    expect(readRuntimeBaseUrl({ baseUrl: "javascript:alert(1)" })).toBeNull();
  });

  // Every build ships public/runtime-config.js; only a hosting server's own
  // copy offers an address.
  it("finds no Base URL in the runtime-config.js every build ships", () => {
    const file = readFileSync(new URL("../../public/runtime-config.js", import.meta.url), "utf8");
    const window: { __LOOMBOARD_CONFIG__?: unknown } = {};
    runInNewContext(file, { window });
    expect(readRuntimeBaseUrl(window.__LOOMBOARD_CONFIG__)).toBeNull();
  });
});
