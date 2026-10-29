import { useEffect, useState, type FormEvent } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { AppClientEntry } from "@loomcycle/client";
import { useConnection, useLoomcycle } from "../state/connection";
import { describeError } from "../chat/lib/errors";
import { isTauri } from "../lib/proxyMode";
import { webRedirectUri } from "../lib/webSignIn";
import { admitsThisApp, appRow, newClient, parseLines, withThisApp, type ThisApp } from "../lib/appClients";

// The apps loomcycle signs people in for (RFC FL), for a tenant operator: the
// ones in its config (read-only here) and the ones registered at runtime
// (ClientDefs), which it can register and retire without a config edit.
//
// A client's redirect URIs decide where a person's sign-in code goes, so every
// write here is something loomcycle audits and may refuse; its refusal is
// shown as it gives it.

/** This build's own redirect URI and origin, when it has one to register. The
 *  desktop app's ship in loomcycle's `loomboard` preset; a web page at
 *  http://localhost has none loomcycle accepts. */
function thisApp(): ThisApp | null {
  if (isTauri) return null;
  const r = webRedirectUri(window.location);
  return "uri" in r ? { redirectUri: r.uri, origin: window.location.origin } : null;
}

export default function AppClients() {
  const client = useLoomcycle();
  const { principal } = useConnection();
  const [entries, setEntries] = useState<AppClientEntry[] | null>(null);
  const [error, setError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [rowError, setRowError] = useState<{ name: string; message: string }>();
  const [retiring, setRetiring] = useState<string>();
  const me = thisApp();

  useEffect(() => {
    const ac = new AbortController();
    client
      .listClientDefs({ signal: ac.signal })
      .then((r) => {
        setEntries(r.clients);
        setError(undefined);
      })
      .catch((e) => !ac.signal.aborted && setError(describeError(e)));
    return () => ac.abort();
  }, [client, reloadKey]);

  async function act(name: string, run: () => Promise<unknown>) {
    setBusy(name);
    setRowError(undefined);
    try {
      await run();
      setRetiring(undefined);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setRowError({ name, message: describeError(e) });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="apps-pane">
      <header className="apps-pane__bar">
        <h2>Apps</h2>
        <button type="button" className="btn-ghost sm" onClick={() => setReloadKey((k) => k + 1)} title="Refresh">
          <RefreshCw size={14} /> Refresh
        </button>
      </header>
      <p className="apps-pane__note">
        The apps that may send people to loomcycle to sign in. An app signs people in only from the redirect URIs
        listed for it, and its browser calls only from the origins listed.
        {me && (
          <>
            {" "}
            This loomboard signs in from <code>{me.redirectUri}</code>.
          </>
        )}
      </p>

      {error ? (
        <p className="apps-pane__error" role="alert">
          {error}
        </p>
      ) : entries === null ? (
        <p className="apps-pane__note apps-pane__loading">
          <Loader2 size={16} className="spin" /> Loading…
        </p>
      ) : entries.length === 0 ? (
        <p className="apps-pane__note">No apps are registered.</p>
      ) : (
        <ul className="apps-list">
          {entries.map((e) => {
            const row = appRow(e);
            return (
              <li key={row.name} className="apps-row">
                <div className="apps-row__head">
                  <div className="apps-row__who">
                    <strong>{row.label || row.name}</strong>
                    <span>
                      <code>{row.name}</code> · signs in people of {row.serves}
                      {row.editable ? ` · v${row.version}` : " · in loomcycle's config, read-only here"}
                    </span>
                  </div>
                  {row.editable && e.source === "def" && me && !admitsThisApp(row, me) && (
                    <button
                      type="button"
                      className="btn-ghost sm"
                      disabled={busy !== undefined}
                      onClick={() => void act(row.name, () => client.updateClientDef(row.name, withThisApp(e.client, me)))}
                      title={`Add ${me.redirectUri} and ${me.origin} to this app`}
                    >
                      Add this loomboard
                    </button>
                  )}
                  {row.editable && (
                    <button
                      type="button"
                      className="btn-ghost sm"
                      disabled={busy !== undefined}
                      onClick={() => setRetiring(row.name)}
                    >
                      Retire
                    </button>
                  )}
                </div>
                <dl className="apps-row__lists">
                  <dt>Redirect URIs</dt>
                  <dd>{row.redirectUris.join("\n") || "none"}</dd>
                  <dt>Allowed origins</dt>
                  <dd>{row.origins.join("\n") || "none"}</dd>
                </dl>
                {retiring === row.name && (
                  <div className="apps-confirm" role="dialog" aria-label={`Retire ${row.name}`}>
                    <p>
                      Retire <strong>{row.name}</strong>? Everyone signed in through it is signed out now, and the name
                      cannot be used again.
                    </p>
                    <button type="button" className="btn-ghost sm" autoFocus onClick={() => setRetiring(undefined)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="apps-confirm__go"
                      disabled={busy !== undefined}
                      onClick={() => void act(row.name, () => client.retireClientDef(row.name))}
                    >
                      {busy === row.name ? <Loader2 size={14} className="spin" /> : "Retire"}
                    </button>
                  </div>
                )}
                {rowError?.name === row.name && (
                  <p className="apps-pane__error" role="alert">
                    {rowError.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <RegisterForm
        me={me}
        // An admin's app signs in every tenant's people unless it names one,
        // so the narrower choice is the default.
        adminTenant={principal?.is_admin || principal?.open_mode ? (principal?.tenant_id ?? "") : null}
        onRegistered={() => setReloadKey((k) => k + 1)}
      />
    </section>
  );
}

function RegisterForm({
  me,
  adminTenant,
  onRegistered,
}: {
  me: ThisApp | null;
  /** The admin's own tenant ("" when it has none); null for a tenant
   *  operator, whose apps are always its own tenant's. */
  adminTenant: string | null;
  onRegistered: () => void;
}) {
  const client = useLoomcycle();
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [redirects, setRedirects] = useState("");
  const [origins, setOrigins] = useState("");
  const [description, setDescription] = useState("");
  const [everyTenant, setEveryTenant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const redirectUris = parseLines(redirects);

  function fillThisApp() {
    if (!me) return;
    if (!name) setName("loomboard");
    if (!label) setLabel("loomboard");
    setRedirects(parseLines(`${redirects}\n${me.redirectUri}`).join("\n"));
    setOrigins(parseLines(`${origins}\n${me.origin}`).join("\n"));
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    if (busy || !name.trim() || redirectUris.length === 0) return;
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    try {
      const tenant = adminTenant === null ? undefined : everyTenant ? "" : adminTenant;
      const rec = await client.createClientDef(name.trim(), newClient(label, redirectUris, parseLines(origins)), {
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(tenant !== undefined ? { tenant } : {}),
      });
      setDone(`Registered ${rec.name}.`);
      setName("");
      setLabel("");
      setRedirects("");
      setOrigins("");
      setDescription("");
      onRegistered();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="apps-form" onSubmit={register}>
      <h3>Register an app</h3>
      {me && (
        <button type="button" className="btn-ghost sm" onClick={fillThisApp}>
          Fill in this loomboard
        </button>
      )}
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="loomboard" spellCheck={false} />
        <small>The app's client id. It cannot be reused once the app is retired.</small>
      </label>
      <label className="field">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="shown on the sign-in page" />
      </label>
      <label className="field">
        <span>Redirect URIs</span>
        <textarea
          rows={3}
          value={redirects}
          onChange={(e) => setRedirects(e.target.value)}
          placeholder="one per line: https://…, http://127.0.0.1:port/…, or myapp://callback"
          spellCheck={false}
        />
        <small>The extension shows its own on its sign-in screen.</small>
      </label>
      <label className="field">
        <span>Allowed origins</span>
        <textarea
          rows={2}
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          placeholder="one per line: https://…, http://127.0.0.1:port, chrome-extension://…"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" />
      </label>
      {adminTenant ? (
        <label className="apps-form__check">
          <input type="checkbox" checked={everyTenant} onChange={(e) => setEveryTenant(e.target.checked)} />
          Sign in people of every tenant (otherwise only tenant {adminTenant})
        </label>
      ) : adminTenant === "" ? (
        <p className="apps-pane__note">It will sign in people of every tenant.</p>
      ) : null}
      {error && (
        <p className="apps-pane__error" role="alert">
          {error}
        </p>
      )}
      {done && <p className="apps-pane__note">{done}</p>}
      <button type="submit" className="btn-primary" disabled={busy || !name.trim() || redirectUris.length === 0}>
        {busy ? <Loader2 size={14} className="spin" /> : "Register"}
      </button>
    </form>
  );
}
