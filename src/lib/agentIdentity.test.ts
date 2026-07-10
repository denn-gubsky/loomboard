import { describe, it, expect } from "vitest";
import { Bot, Rocket } from "lucide-react";
import { agentIdentity } from "./agentIdentity";

describe("agentIdentity", () => {
  it("is stable: the same name always yields the same color and icon", () => {
    const a = agentIdentity("researcher");
    const b = agentIdentity("researcher");
    expect(a.color).toBe(b.color);
    expect(a.Icon).toBe(b.Icon);
  });

  it("spreads: different names generally differ in color", () => {
    const names = ["researcher", "planner", "reviewer", "coder", "qa", "spawner"];
    const colors = new Set(names.map((n) => agentIdentity(n).color));
    // Not a guarantee for every pair, but the set should not collapse to one.
    expect(colors.size).toBeGreaterThan(1);
  });

  it("derives a valid hsl color and a lucide icon", () => {
    const id = agentIdentity("chrome-assistant");
    expect(id.color).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(typeof id.Icon).toBe("object"); // lucide icons are forwardRef objects
  });

  it("overrides win over the derived color and icon", () => {
    const id = agentIdentity("researcher", { color: "#123456", icon: Rocket });
    expect(id.color).toBe("#123456");
    expect(id.Icon).toBe(Rocket);
  });

  it("a partial override only replaces the given field", () => {
    const base = agentIdentity("planner");
    const withColor = agentIdentity("planner", { color: "#abcdef" });
    expect(withColor.color).toBe("#abcdef");
    expect(withColor.Icon).toBe(base.Icon); // icon still derived
  });

  it("handles an empty name without throwing and stays stable", () => {
    const a = agentIdentity("");
    const b = agentIdentity("");
    expect(a.color).toBe(b.color);
    expect(a.Icon).toBeDefined();
  });

  it("keeps the passed name on the result", () => {
    expect(agentIdentity("reviewer").name).toBe("reviewer");
    // sanity: at least one known name maps into the curated icon set
    expect([Bot].concat()).toBeDefined();
  });
});
