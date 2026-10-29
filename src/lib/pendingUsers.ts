import type { UserSummary } from "@loomcycle/client";

// The approval queue (RFC FA §3.7a): a sign-in gate with
// `new_user.status: pending` provisions people who can sign in but are refused
// everything until an operator approves them. loomcycle has no list of just
// those, so the queue is the tenant's user list filtered to `pending`.

/** The users awaiting approval, by name. */
export function pendingUsers(users: readonly UserSummary[]): UserSummary[] {
  return users
    .filter((u) => u.status === "pending")
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

/** What to call a user: its display name, else its subject. */
export function nameOf(u: UserSummary): string {
  return u.display_name || u.user_id;
}
