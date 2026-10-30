import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `tauri build` stops with "Found version mismatched Tauri packages" when an
// npm package and its Rust crate are on different major.minor releases. Only
// release.yml runs it, on a tag, so a bump that splits a pair (Dependabot moves
// npm and Cargo in separate PRs) would pass CI and break the next release.
// Same pairs as the CLI's check: @tauri-apps/api with tauri, and each
// @tauri-apps/plugin-X with tauri-plugin-X.

const root = new URL("../", import.meta.url);

function npmVersions(): Map<string, string> {
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  const versions = new Map<string, string>();
  for (const [path, pkg] of Object.entries(lock.packages)) {
    const m = path.match(/^node_modules\/(@tauri-apps\/(?:api|plugin-[\w-]+))$/);
    if (m && pkg.version) versions.set(m[1], pkg.version);
  }
  return versions;
}

function crateVersions(): Map<string, string> {
  const lock = readFileSync(new URL("src-tauri/Cargo.lock", root), "utf8");
  const versions = new Map<string, string>();
  for (const m of lock.matchAll(/^name = "([^"]+)"\nversion = "([^"]+)"$/gm)) {
    versions.set(m[1], m[2]);
  }
  return versions;
}

const majorMinor = (v: string) => v.split(".").slice(0, 2).join(".");

describe("Tauri package versions", () => {
  const npm = npmVersions();
  const crates = crateVersions();

  it("finds the npm packages and crates it compares", () => {
    expect(npm.get("@tauri-apps/api")).toBeDefined();
    expect(crates.get("tauri")).toBeDefined();
  });

  it("keeps each npm package on its Rust crate's major.minor, as tauri build requires", () => {
    const pairs = [...npm].map(([pkg, version]) => {
      const crate = pkg === "@tauri-apps/api" ? "tauri" : pkg.replace("@tauri-apps/", "tauri-");
      return { pkg, npm: version, crate, cargo: crates.get(crate) ?? "missing" };
    });
    const split = pairs.filter((p) => majorMinor(p.npm) !== majorMinor(p.cargo));
    expect(split).toEqual([]);
  });
});
