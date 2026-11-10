import { describe, expect, it } from "vitest";
import type { ClientDefRecord, ConfigAppClient } from "@loomcycle/client";
import { admitsThisApp, appRow, extensionInstall, newClient, parseLines, withThisApp } from "./appClients";

const def: ClientDefRecord = {
  name: "loomboard",
  source: "def",
  def_id: "cdef_1",
  version: 2,
  tenant_id: "acme",
  all_tenants: false,
  label: "loomboard",
  redirect_uris: ["http://127.0.0.1:5173/auth/callback"],
  client: {
    kind: "public",
    label: "loomboard",
    redirect_uris: ["http://127.0.0.1:5173/auth/callback"],
    allowed_origins: ["http://127.0.0.1:5173"],
    access_token_ttl: "30m",
  },
  description: "",
  content_sha256: "",
  created_at: "",
  created_by: "op",
  created_by_tenant: "acme",
  read_only: false,
};

const config: ConfigAppClient = {
  name: "cli",
  source: "config",
  label: "CLI",
  all_tenants: true,
  tenant_id: "",
  redirect_uris: ["http://127.0.0.1/cb"],
  allowed_origins: [],
  access_token_ttl: "1h",
  refresh_idle: "",
  refresh_absolute: "",
  read_only: true,
};

const web = { redirectUri: "https://board.example/auth/callback", origin: "https://board.example" };

describe("appRow", () => {
  it("reads a registered app's origins from its definition, and lets it be changed", () => {
    expect(appRow(def)).toEqual({
      name: "loomboard",
      label: "loomboard",
      serves: "tenant acme",
      redirectUris: ["http://127.0.0.1:5173/auth/callback"],
      origins: ["http://127.0.0.1:5173"],
      editable: true,
      version: 2,
    });
  });

  it("marks a config app read-only and serving every tenant", () => {
    expect(appRow(config)).toMatchObject({ serves: "every tenant", editable: false, version: undefined, origins: [] });
  });
});

describe("parseLines", () => {
  it("keeps each non-blank line once, trimmed", () => {
    expect(parseLines(" a \n\nb\na\n  ")).toEqual(["a", "b"]);
  });
});

describe("newClient", () => {
  it("builds a public client and leaves out what was not given", () => {
    expect(newClient("  ", ["https://x/cb"], [])).toEqual({ kind: "public", redirect_uris: ["https://x/cb"] });
    expect(newClient("X", ["https://x/cb"], ["https://x"])).toEqual({
      kind: "public",
      label: "X",
      redirect_uris: ["https://x/cb"],
      allowed_origins: ["https://x"],
    });
  });
});

describe("withThisApp / admitsThisApp", () => {
  it("adds this loomboard and keeps the rest of the definition", () => {
    const next = withThisApp(def.client, web);
    expect(next.redirect_uris).toEqual([...def.client.redirect_uris, web.redirectUri]);
    expect(next.allowed_origins).toEqual([...def.client.allowed_origins!, web.origin]);
    expect(next.access_token_ttl).toBe("30m");
    expect(next.label).toBe("loomboard");
  });

  it("adds nothing twice", () => {
    const once = withThisApp(def.client, web);
    expect(withThisApp(once, web)).toEqual(once);
  });

  it("admits this loomboard only when both its redirect URI and its origin are listed", () => {
    const local = { redirectUri: "http://127.0.0.1:5173/auth/callback", origin: "http://127.0.0.1:5173" };
    expect(admitsThisApp(appRow(def), local)).toBe(true);
    expect(admitsThisApp(appRow(def), web)).toBe(false);
    expect(admitsThisApp(appRow({ ...def, client: { ...def.client, allowed_origins: [] } }), local)).toBe(false);
  });
});

describe("extensionInstall", () => {
  const ID = "abcdefghijklmnopabcdefghijklmnop";
  const want = { redirectUri: `https://${ID}.chromiumapp.org/`, origin: `chrome-extension://${ID}` };

  it("reads an install from its ID or either address its sign-in screen shows", () => {
    expect(extensionInstall(ID)).toEqual(want);
    expect(extensionInstall(`  chrome-extension://${ID}/ `)).toEqual(want);
    expect(extensionInstall(`https://${ID}.chromiumapp.org/`)).toEqual(want);
    expect(extensionInstall(ID.toUpperCase())).toEqual(want);
  });

  it("refuses anything that is not a Chrome extension ID", () => {
    expect(extensionInstall("")).toBeNull();
    expect(extensionInstall(ID.slice(1))).toBeNull();
    expect(extensionInstall("q".repeat(32))).toBeNull();
    expect(extensionInstall(`https://${ID}.chromiumapp.org.evil.example/`)).toBeNull();
    expect(extensionInstall(`https://evil.example/${ID}`)).toBeNull();
  });
});
