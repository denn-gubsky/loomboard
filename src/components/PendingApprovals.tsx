import { useEffect, useState } from "react";
import { Loader2, RefreshCw, UserCheck } from "lucide-react";
import { LoomcycleError, type UserIdentity, type UserSummary } from "@loomcycle/client";
import { useConnection, useLoomcycle } from "../state/connection";
import { describeError } from "../chat/lib/errors";
import { nameOf, pendingUsers } from "../lib/pendingUsers";

// The people a sign-in gate has let sign in but nobody has approved yet: until
// approved, loomcycle refuses them everything. A tenant operator lets them in
// here. It works in the principal's own tenant; an admin approving in another
// tenant uses loomcycle's console.

export default function PendingApprovals() {
  const client = useLoomcycle();
  const { principal } = useConnection();
  // Named explicitly so an admin, whose list would otherwise span every
  // tenant, sees and approves in its own one.
  const tenant = principal?.tenant_id || undefined;
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [approving, setApproving] = useState<string>();
  const [rowError, setRowError] = useState<{ subject: string; message: string }>();
  const [expanded, setExpanded] = useState<string>();

  useEffect(() => {
    const ac = new AbortController();
    client
      .listUsers({ tenant, signal: ac.signal })
      .then((r) => {
        setUsers(pendingUsers(r.users));
        setError(undefined);
      })
      .catch((e) => !ac.signal.aborted && setError(describeError(e)));
    return () => ac.abort();
  }, [client, tenant, reloadKey]);

  async function approve(subject: string) {
    setApproving(subject);
    setRowError(undefined);
    try {
      await client.approveUser(subject, { tenant });
      setUsers((cur) => cur?.filter((u) => u.user_id !== subject) ?? null);
    } catch (e) {
      // Approved or removed elsewhere since the list loaded: the list is stale,
      // not the approval wrong.
      if (e instanceof LoomcycleError && (e.code === "not_pending" || e.code === "user_not_found")) {
        setReloadKey((k) => k + 1);
      } else {
        setRowError({ subject, message: describeError(e) });
      }
    } finally {
      setApproving(undefined);
    }
  }

  return (
    <section className="users-pane">
      <header className="users-pane__bar">
        <h2>Waiting for approval</h2>
        <button type="button" className="btn-ghost sm" onClick={() => setReloadKey((k) => k + 1)} title="Refresh">
          <RefreshCw size={14} /> Refresh
        </button>
      </header>
      <p className="users-pane__note">
        These people signed in through a sign-in option that holds new users for approval. loomcycle refuses
        them everything until you approve them.
      </p>
      {error ? (
        <p className="users-pane__error" role="alert">
          {error}
        </p>
      ) : users === null ? (
        <p className="users-pane__empty">
          <Loader2 size={16} className="spin" /> Loading…
        </p>
      ) : users.length === 0 ? (
        <p className="users-pane__empty">No one is waiting for approval.</p>
      ) : (
        <ul className="users-list">
          {users.map((u) => (
            <li key={u.user_id} className="users-row">
              <div className="users-row__head">
                <div className="users-row__who">
                  <strong>{nameOf(u)}</strong>
                  {u.display_name && <code>{u.user_id}</code>}
                </div>
                <button
                  type="button"
                  className="btn-ghost sm"
                  aria-expanded={expanded === u.user_id}
                  onClick={() => setExpanded((cur) => (cur === u.user_id ? undefined : u.user_id))}
                >
                  Sign-in accounts
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={approving !== undefined}
                  onClick={() => void approve(u.user_id)}
                >
                  {approving === u.user_id ? <Loader2 size={14} className="spin" /> : <UserCheck size={14} />} Approve
                </button>
              </div>
              {rowError?.subject === u.user_id && (
                <p className="users-pane__error" role="alert">
                  {rowError.message}
                </p>
              )}
              {expanded === u.user_id && <Identities subject={u.user_id} tenant={tenant} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The identity-provider accounts a user signs in with, so the operator can see
// who this is before letting them in.
function Identities({ subject, tenant }: { subject: string; tenant?: string }) {
  const client = useLoomcycle();
  const [rows, setRows] = useState<UserIdentity[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const ac = new AbortController();
    client
      .listUserIdentities(subject, { tenant, signal: ac.signal })
      .then((r) => setRows(r.identities))
      .catch((e) => !ac.signal.aborted && setError(describeError(e)));
    return () => ac.abort();
  }, [client, subject, tenant]);

  if (error) return <p className="users-pane__error">{error}</p>;
  if (rows === null) return <p className="users-ids__empty">Loading…</p>;
  // A password-gate login is not an identity-provider account, so it is not
  // listed here.
  if (rows.length === 0) return <p className="users-ids__empty">No identity-provider account is linked.</p>;
  return (
    <table className="users-ids">
      <thead>
        <tr>
          <th>Sign-in option</th>
          <th>Account</th>
          <th>Email</th>
          <th>Last sign-in</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i.gate}>
            <td>{i.gate}</td>
            <td>
              <code>{i.external_subject}</code>
              {i.issuer && <div className="users-ids__issuer">{i.issuer}</div>}
            </td>
            <td>
              {i.email ?? "—"}
              {i.email && !i.email_verified && <span className="users-ids__unverified"> (not verified)</span>}
            </td>
            <td>{i.last_login_at ? new Date(i.last_login_at).toLocaleString() : "never"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
