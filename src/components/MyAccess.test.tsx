// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoomcycleError, type WhoamiResponse } from "@loomcycle/client";
import MyAccess from "./MyAccess";

const authzExplain = vi.fn();
const getAclCatalog = vi.fn();
// One client for every render, as the app's getClient keeps one.
const client = { authzExplain, getAclCatalog };
let principal: WhoamiResponse;

vi.mock("../state/connection", () => ({
  useLoomcycle: () => client,
  useConnection: () => ({ principal, signIn: null }),
}));

beforeEach(() => {
  principal = {
    tenant_id: "acme",
    subject: "ada",
    scopes: ["runs:create"],
    is_admin: false,
    legacy: false,
    acl_mode: "enforce",
    acl_version: 4,
    groups: ["eng"],
  };
  // A member: the rule catalog is an operator read.
  getAclCatalog.mockRejectedValue(new LoomcycleError("forbidden", { status: 403, code: "insufficient_scope" }));
  authzExplain.mockResolvedValue({
    decision: { decision: false, outcome: "deny", mode: "enforce", reasons: [{ acl: "interns", version: 3, rule: 1, effect: "deny" }] },
    traces: [{ acl: "interns", version: 3, rule: 1, effect: "deny", matched: true, why: "tool:Bash matches tool:*" }],
    missing_acls: ["gone"],
    applied_bindings: [{ acl: "interns", subject_kind: "group", subject_id: "eng" }],
    groups: ["eng"],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function ask(action: string, type: string, name = "") {
  fireEvent.change(screen.getByLabelText("action"), { target: { value: action } });
  fireEvent.change(screen.getByLabelText("resource type"), { target: { value: type } });
  fireEvent.change(screen.getByLabelText("resource name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

describe("MyAccess", () => {
  it("shows how the principal is connected and which rules apply", () => {
    render(<MyAccess />);
    expect(screen.getByText("ada")).toBeTruthy();
    expect(screen.getByText("A token")).toBeTruthy();
    expect(screen.getByText("v4")).toBeTruthy();
    expect(screen.getByText("eng")).toBeTruthy();
  });

  it("answers a question about the caller with the rules that decided it", async () => {
    render(<MyAccess />);
    ask("invoke", "tool", "Bash");
    expect(await screen.findByText("deny", { selector: ".access-pill" })).toBeTruthy();
    // About the caller: no subject is named.
    expect(authzExplain).toHaveBeenCalledWith({ action: { name: "invoke" }, resource: { type: "tool", id: "Bash" } });
    expect(screen.getByText(/Decided by list "interns" v3 rule 1/)).toBeTruthy();
    expect(screen.getByText("tool:Bash matches tool:*")).toBeTruthy();
    expect(screen.getByText(/Lists bound to you: "interns" → group eng/)).toBeTruthy();
    expect(screen.getByText(/not found, so they decide nothing: gone/)).toBeTruthy();
  });

  it("shows loomcycle's refusal of a malformed question", async () => {
    authzExplain.mockRejectedValue(
      new LoomcycleError("bad request", {
        status: 400,
        code: "invalid_request",
        bodyText: JSON.stringify({ code: "invalid_request", error: '"fly" is not a verb of agent' }),
      }),
    );
    render(<MyAccess />);
    ask("fly", "agent");
    expect((await screen.findByRole("alert")).textContent).toMatch(/not a verb of agent/);
  });

  it("offers the catalog's types and verbs when the principal may read it", async () => {
    getAclCatalog.mockResolvedValue({ catalog_version: 1, transports: [], types: [{ type: "agent", verbs: ["run", "read"] }] });
    const { container } = render(<MyAccess />);
    await screen.findByText("May I…?");
    fireEvent.change(screen.getByLabelText("resource type"), { target: { value: "agent" } });
    await vi.waitFor(() => expect(container.querySelectorAll("#access-verbs option")).toHaveLength(2));
    expect(container.querySelector('#access-types option[value="agent"]')).toBeTruthy();
  });

  it("leaves out the rules and the question on a server without access rules", () => {
    principal = { ...principal, acl_mode: undefined, acl_version: undefined, groups: undefined };
    render(<MyAccess />);
    expect(screen.getByText("This loomcycle has no access rules.")).toBeTruthy();
    expect(screen.queryByText("May I…?")).toBeNull();
    expect(getAclCatalog).not.toHaveBeenCalled();
  });
});
