import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { AclCatalog, AuthzExplainResponse } from "@loomcycle/client";
import { useConnection, useLoomcycle } from "../state/connection";
import { describeError } from "../chat/lib/errors";
import { bindingLine, connectionFacts, decidingReasons, modeNote, outcomeNote, selfQuestion } from "../lib/myAccess";

// What the connected principal is, and what its access rules let it do. For
// everyone: every question here is about the caller itself, which loomcycle
// answers for any principal. Managing other people's access stays in
// loomcycle's console.

export default function MyAccess() {
  const client = useLoomcycle();
  const { principal, signIn } = useConnection();
  // The rule catalog (types and their verbs) is an operator read: a member
  // gets a refusal, and types the question without suggestions.
  const [catalog, setCatalog] = useState<AclCatalog | null>(null);
  const [action, setAction] = useState("");
  const [type, setType] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [answer, setAnswer] = useState<AuthzExplainResponse | null>(null);

  const hasRules = Boolean(principal?.acl_mode);
  useEffect(() => {
    if (!hasRules) return;
    const ac = new AbortController();
    client
      .getAclCatalog({ signal: ac.signal })
      .then(setCatalog)
      .catch(() => {});
    return () => ac.abort();
  }, [client, hasRules]);

  if (!principal) return null;
  const question = selfQuestion(action, type, name);
  const verbs = catalog?.types.find((t) => t.type === type.trim())?.verbs ?? [];

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question || busy) return;
    setBusy(true);
    setError(undefined);
    setAnswer(null);
    try {
      setAnswer(await client.authzExplain(question));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="access-pane">
      <h2>My access</h2>

      <h3>How you are connected</h3>
      <dl className="access-facts">
        {connectionFacts(principal, signIn !== null).map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>

      <h3>Access rules</h3>
      <p className="access-note">{modeNote(principal.acl_mode)}</p>
      {hasRules && (
        <dl className="access-facts">
          <div>
            <dt>Mode</dt>
            <dd>{principal.acl_mode}</dd>
          </div>
          {principal.acl_version !== undefined && (
            <div>
              <dt>Your rules' version</dt>
              <dd>v{principal.acl_version}</dd>
            </div>
          )}
          <div>
            <dt>Groups</dt>
            <dd>{principal.groups?.length ? principal.groups.join(", ") : "none"}</dd>
          </div>
        </dl>
      )}

      {hasRules && (
        <>
          <h3>May I…?</h3>
          <form className="access-ask" onSubmit={ask}>
            <span>May I</span>
            <input
              aria-label="action"
              placeholder="action, e.g. run"
              list="access-verbs"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              spellCheck={false}
            />
            <input
              aria-label="resource type"
              placeholder="type, e.g. agent"
              list="access-types"
              value={type}
              onChange={(e) => setType(e.target.value)}
              spellCheck={false}
            />
            <span>:</span>
            <input
              aria-label="resource name"
              placeholder="name (blank = any)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
            />
            <span>?</span>
            <button type="submit" className="btn-primary" disabled={!question || busy}>
              {busy ? <Loader2 size={14} className="spin" /> : "Ask"}
            </button>
            <datalist id="access-types">
              {catalog?.types.map((t) => <option key={t.type} value={t.type} />)}
            </datalist>
            <datalist id="access-verbs">
              {verbs.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </form>
          {error && (
            <p className="access-error" role="alert">
              {error}
            </p>
          )}
          {answer && <Answer answer={answer} />}
        </>
      )}
    </section>
  );
}

function Answer({ answer }: { answer: AuthzExplainResponse }) {
  const d = answer.decision;
  const deciding = decidingReasons(d);
  const traces = answer.traces ?? [];
  const missing = answer.missing_acls ?? [];
  const applied = answer.applied_bindings ?? [];
  return (
    <div className="access-answer">
      <p className="access-answer__head">
        <span className={`access-pill access-pill--${d.outcome}`}>
          {d.outcome === "no_match" ? "no rule matched" : d.outcome}
        </span>{" "}
        {outcomeNote(d)}
      </p>
      {deciding.length > 0 && (
        <p>
          Decided by{" "}
          {deciding
            .map((r) => `list "${r.acl}"${r.version !== undefined ? ` v${r.version}` : ""} rule ${r.rule}`)
            .join("; ")}
          .
        </p>
      )}
      {traces.length > 0 && (
        <table className="access-trace">
          <caption>Every rule read for this type</caption>
          <thead>
            <tr>
              <th>List</th>
              <th>Rule</th>
              <th>Effect</th>
              <th>Matched</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t) => (
              <tr key={`${t.acl}/${t.rule}`}>
                <td>
                  {t.acl}
                  {t.version !== undefined && ` v${t.version}`}
                </td>
                <td>{t.rule}</td>
                <td>{t.effect}</td>
                <td>{t.matched ? "yes" : "no"}</td>
                <td>{t.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>Lists bound to you: {applied.length ? applied.map(bindingLine).join("; ") : "none"}.</p>
      {missing.length > 0 && (
        <p className="access-error">Bound to you but not found, so they decide nothing: {missing.join(", ")}.</p>
      )}
    </div>
  );
}
