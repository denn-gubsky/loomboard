// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSettings as Settings } from "../state/settings";

// The sign-in screen of a hosted loomboard: the Base URL its server offers in
// /runtime-config.js is where a first visit starts, and what a blank field
// means. This runs as the web build (not desktop, not extension).

let settings: Settings | null = null;
vi.mock("../state/connection", () => ({
  useConnection: () => ({
    settings,
    status: "idle",
    error: null,
    problem: null,
    connect: vi.fn(),
    signInWithLoomcycle: vi.fn(),
    retrySignIn: vi.fn(),
    cancelSignIn: vi.fn(),
  }),
}));

import ConnectionSettings from "./ConnectionSettings";

const field = () => screen.getByRole("textbox", { name: /Base URL/ }) as HTMLInputElement;

beforeEach(() => {
  settings = null;
});
afterEach(() => {
  cleanup();
  delete (window as { __LOOMBOARD_CONFIG__?: unknown }).__LOOMBOARD_CONFIG__;
});

function hostWith(config: unknown) {
  (window as { __LOOMBOARD_CONFIG__?: unknown }).__LOOMBOARD_CONFIG__ = config;
}

describe("ConnectionSettings", () => {
  it("starts with the hosting server's Base URL, and a blank field means it", () => {
    hostWith({ connectOrigins: [], baseUrl: "https://loomcycle.example" });
    render(<ConnectionSettings />);
    expect(field().value).toBe("https://loomcycle.example");
    expect(screen.getByText("https://loomcycle.example", { selector: "code" })).toBeTruthy();
  });

  it("keeps saved settings over the offered Base URL, a blank one included", () => {
    hostWith({ connectOrigins: [], baseUrl: "https://loomcycle.example" });
    settings = { baseUrl: "https://other.example", token: "" };
    render(<ConnectionSettings />);
    expect(field().value).toBe("https://other.example");
    cleanup();
    settings = { baseUrl: "", token: "" };
    render(<ConnectionSettings />);
    expect(field().value).toBe("");
  });

  it("starts empty when the server offers no Base URL", () => {
    render(<ConnectionSettings />);
    expect(field().value).toBe("");
  });
});
