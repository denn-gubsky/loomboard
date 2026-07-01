import { describe, it, expect } from "vitest";
import { parseTheme, pickTheme } from "./theme";

describe("parseTheme", () => {
  it("accepts the two valid themes", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("rejects absent or garbage values", () => {
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme("")).toBeNull();
    expect(parseTheme("Dark")).toBeNull();
    expect(parseTheme("system")).toBeNull();
  });
});

describe("pickTheme", () => {
  it("prefers an explicit saved choice over the OS preference", () => {
    expect(pickTheme("dark", true)).toBe("dark");
    expect(pickTheme("light", false)).toBe("light");
  });

  it("falls back to the OS preference when nothing is saved", () => {
    expect(pickTheme(null, true)).toBe("light");
    expect(pickTheme(null, false)).toBe("dark");
  });
});
