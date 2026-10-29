// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoomcycleError, type UserSummary } from "@loomcycle/client";
import PendingApprovals from "./PendingApprovals";

function user(user_id: string, status: string, display_name?: string): UserSummary {
  return { user_id, status, display_name, running_count: 0, total_count: 0, last_started_at: "" };
}

const listUsers = vi.fn();
const approveUser = vi.fn();
const listUserIdentities = vi.fn();

// One client for every render, as the app's getClient keeps one.
const client = { listUsers, approveUser, listUserIdentities };

// Stub the connection rather than standing up a provider: what is under test
// is the approval queue, not the login.
vi.mock("../state/connection", () => ({
  useLoomcycle: () => client,
  useConnection: () => ({ principal: { tenant_id: "acme", subject: "op" } }),
}));

beforeEach(() => {
  listUsers.mockResolvedValue({
    users: [user("github:1", "pending", "Ada"), user("bob", "active"), user("oidc:7", "pending")],
  });
  approveUser.mockResolvedValue({});
  listUserIdentities.mockResolvedValue({ subject: "github:1", identities: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PendingApprovals", () => {
  it("lists only the people awaiting approval, in the principal's tenant", async () => {
    render(<PendingApprovals />);
    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.getByText("oidc:7")).toBeTruthy();
    expect(screen.queryByText("bob")).toBeNull();
    expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ tenant: "acme" }));
  });

  it("removes an approved person from the queue", async () => {
    render(<PendingApprovals />);
    await screen.findByText("Ada");
    fireEvent.click(screen.getAllByRole("button", { name: /Approve/ })[0]);
    await waitFor(() => expect(screen.queryByText("Ada")).toBeNull());
    expect(approveUser).toHaveBeenCalledWith("github:1", { tenant: "acme" });
    expect(screen.getByText("oidc:7")).toBeTruthy();
  });

  it("keeps the person queued and says why when the approval is refused", async () => {
    approveUser.mockRejectedValue(
      new LoomcycleError("forbidden", {
        status: 403,
        code: "target_beyond_floor",
        bodyText: JSON.stringify({ code: "target_beyond_floor", error: "this user is beyond your floor" }),
      }),
    );
    render(<PendingApprovals />);
    await screen.findByText("Ada");
    fireEvent.click(screen.getAllByRole("button", { name: /Approve/ })[0]);
    expect((await screen.findByRole("alert")).textContent).toMatch(/beyond your floor/);
    expect(screen.getByText("Ada")).toBeTruthy();
  });

  it("reloads the queue when the person was approved elsewhere", async () => {
    approveUser.mockRejectedValue(new LoomcycleError("conflict", { status: 409, code: "not_pending" }));
    render(<PendingApprovals />);
    await screen.findByText("Ada");
    listUsers.mockResolvedValue({ users: [user("oidc:7", "pending")] });
    fireEvent.click(screen.getAllByRole("button", { name: /Approve/ })[0]);
    await waitFor(() => expect(screen.queryByText("Ada")).toBeNull());
    expect(listUsers).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the accounts a person signs in with, on request", async () => {
    listUserIdentities.mockResolvedValue({
      subject: "github:1",
      identities: [
        { gate: "github", external_subject: "12345", email: "ada@example.com", email_verified: false, created_at: "" },
      ],
    });
    render(<PendingApprovals />);
    await screen.findByText("Ada");
    fireEvent.click(screen.getAllByRole("button", { name: "Sign-in accounts" })[0]);
    expect(await screen.findByText("12345")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText(/not verified/)).toBeTruthy();
    expect(screen.getByText("never")).toBeTruthy();
    expect(listUserIdentities).toHaveBeenCalledWith("github:1", expect.objectContaining({ tenant: "acme" }));
  });

  it("says so when no one is waiting", async () => {
    listUsers.mockResolvedValue({ users: [user("bob", "active")] });
    render(<PendingApprovals />);
    expect(await screen.findByText("No one is waiting for approval.")).toBeTruthy();
  });
});
