// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoomcycleError, type ClientDefRecord, type WhoamiResponse } from "@loomcycle/client";
import AppClients from "./AppClients";

const listClientDefs = vi.fn();
const createClientDef = vi.fn();
const updateClientDef = vi.fn();
const retireClientDef = vi.fn();
// One client for every render, as the app's getClient keeps one.
const client = { listClientDefs, createClientDef, updateClientDef, retireClientDef };
let principal: WhoamiResponse;

vi.mock("../state/connection", () => ({
  useLoomcycle: () => client,
  useConnection: () => ({ principal }),
}));

// jsdom's page is http://localhost:3000, which loomcycle would refuse as a
// redirect; the app is opened at 127.0.0.1 for sign-in.
const ORIGIN = "http://127.0.0.1:5173";
const CALLBACK = `${ORIGIN}/auth/callback`;

const registered: ClientDefRecord = {
  name: "loomboard",
  source: "def",
  def_id: "cdef_1",
  version: 1,
  tenant_id: "acme",
  all_tenants: false,
  label: "loomboard",
  redirect_uris: ["http://127.0.0.1:4173/auth/callback"],
  client: { kind: "public", redirect_uris: ["http://127.0.0.1:4173/auth/callback"], allowed_origins: ["http://127.0.0.1:4173"] },
  description: "",
  content_sha256: "",
  created_at: "",
  created_by: "op",
  created_by_tenant: "acme",
  read_only: false,
};

beforeEach(() => {
  vi.stubGlobal("location", new URL(`${ORIGIN}/`));
  principal = { tenant_id: "acme", subject: "op", scopes: ["substrate:tenant"], is_admin: false, legacy: false };
  listClientDefs.mockResolvedValue({
    clients: [
      registered,
      {
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
      },
    ],
  });
  createClientDef.mockImplementation(async (name: string) => ({ ...registered, name }));
  updateClientDef.mockResolvedValue(registered);
  retireClientDef.mockResolvedValue({ name: "loomboard", retired: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AppClients", () => {
  it("lists registered and config apps, offering changes only on the registered ones", async () => {
    render(<AppClients />);
    expect(await screen.findByText("CLI")).toBeTruthy();
    expect(screen.getByText(/in loomcycle's config, read-only here/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Retire" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add this loomboard" })).toHaveLength(1);
  });

  it("adds this loomboard's redirect URI and origin to a registered app, keeping the rest", async () => {
    render(<AppClients />);
    fireEvent.click(await screen.findByRole("button", { name: "Add this loomboard" }));
    await waitFor(() => expect(updateClientDef).toHaveBeenCalled());
    expect(updateClientDef).toHaveBeenCalledWith("loomboard", {
      kind: "public",
      redirect_uris: ["http://127.0.0.1:4173/auth/callback", CALLBACK],
      allowed_origins: ["http://127.0.0.1:4173", ORIGIN],
    });
    await waitFor(() => expect(listClientDefs).toHaveBeenCalledTimes(2));
  });

  it("retires an app only after it is confirmed", async () => {
    render(<AppClients />);
    fireEvent.click(await screen.findByRole("button", { name: "Retire" }));
    expect(retireClientDef).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Retire loomboard" });
    expect(dialog.textContent).toMatch(/signed out now/);
    fireEvent.click(screen.getAllByRole("button", { name: "Retire" }).at(-1)!);
    await waitFor(() => expect(retireClientDef).toHaveBeenCalledWith("loomboard"));
  });

  it("shows loomcycle's refusal on the app's row", async () => {
    retireClientDef.mockRejectedValue(
      new LoomcycleError("refused", {
        status: 403,
        code: "acl_denied",
        bodyText: JSON.stringify({
          code: "acl_denied",
          action: "retire",
          resource: "def:client/loomboard",
          reasons: [{ acl: "ops", rule: 0, effect: "deny" }],
        }),
      }),
    );
    render(<AppClients />);
    fireEvent.click(await screen.findByRole("button", { name: "Retire" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Retire" }).at(-1)!);
    expect((await screen.findByRole("alert")).textContent).toBe(
      'Access denied: you may not retire def:client/loomboard — denied by list "ops" rule 0.',
    );
  });

  it("registers this loomboard as a new app in the operator's own tenant", async () => {
    listClientDefs.mockResolvedValue({ clients: [] });
    render(<AppClients />);
    await screen.findByText("No apps are registered.");
    fireEvent.click(screen.getByRole("button", { name: "Fill in this loomboard" }));
    expect(screen.queryByLabelText(/every tenant/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(createClientDef).toHaveBeenCalled());
    expect(createClientDef).toHaveBeenCalledWith(
      "loomboard",
      { kind: "public", label: "loomboard", redirect_uris: [CALLBACK], allowed_origins: [ORIGIN] },
      {},
    );
    expect(await screen.findByText("Registered loomboard.")).toBeTruthy();
  });

  it("registers an admin's app for its own tenant unless every tenant is chosen", async () => {
    principal = { ...principal, scopes: ["substrate:admin"], is_admin: true };
    render(<AppClients />);
    await screen.findByText("CLI");
    fireEvent.change(screen.getByPlaceholderText("loomboard"), { target: { value: "app" } });
    fireEvent.change(screen.getByPlaceholderText(/one per line: https:\/\/…, http:\/\/127.0.0.1:port\/…/), {
      target: { value: "https://app.example/cb" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(createClientDef).toHaveBeenCalledTimes(1));
    expect(createClientDef.mock.calls[0][2]).toEqual({ tenant: "acme" });

    fireEvent.change(screen.getByPlaceholderText("loomboard"), { target: { value: "app2" } });
    fireEvent.change(screen.getByPlaceholderText(/one per line: https:\/\/…, http:\/\/127.0.0.1:port\/…/), {
      target: { value: "https://app.example/cb" },
    });
    fireEvent.click(screen.getByLabelText(/every tenant/));
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(createClientDef).toHaveBeenCalledTimes(2));
    expect(createClientDef.mock.calls[1][2]).toEqual({ tenant: "" });
  });

  it("offers no fill-in on a page whose address loomcycle would refuse as a redirect", async () => {
    vi.stubGlobal("location", new URL("http://localhost:5173/"));
    render(<AppClients />);
    await screen.findByText("CLI");
    expect(screen.queryByRole("button", { name: "Fill in this loomboard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add this loomboard" })).toBeNull();
  });
});
