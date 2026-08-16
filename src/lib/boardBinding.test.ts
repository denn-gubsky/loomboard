import { describe, it, expect } from "vitest";
import { readBoardConfig, withBoardTeam } from "./boardBinding";

describe("readBoardConfig", () => {
  it("reads the team pointer from root-chunk fields", () => {
    expect(readBoardConfig({ team: "sdlc", other: 1 })).toEqual({ team: "sdlc" });
  });
  it("returns empty for missing / blank / non-object", () => {
    expect(readBoardConfig(null)).toEqual({});
    expect(readBoardConfig("x")).toEqual({});
    expect(readBoardConfig({ team: "" })).toEqual({});
  });
});

describe("withBoardTeam", () => {
  it("merges a team pointer, preserving other fields", () => {
    expect(withBoardTeam({ other: 1 }, "sdlc")).toEqual({ other: 1, team: "sdlc" });
  });
  it("clears the pointer when team is undefined", () => {
    expect(withBoardTeam({ team: "old", other: 1 }, undefined)).toEqual({ other: 1 });
  });
  it("handles a null base", () => {
    expect(withBoardTeam(null, "x")).toEqual({ team: "x" });
  });
});
