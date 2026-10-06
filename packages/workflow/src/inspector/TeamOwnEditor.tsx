import { useEffect, useState } from "react";
import { FoldedFieldList, agentDefRegistry, type DefValue } from "@loomcycle/def-fields";
import type { JsonObject } from "../lib/model";
import { LOCAL_KINDS, type LocalKind, type TeamOwnEntry } from "../lib/teamLocal";
import { WEBHOOK_SECRET_FIELD } from "../lib/localEdit";

// The team's own definitions (RFC DV), editable: what the team declares for
// itself under `local`. One section per kind, each with an Add row; each entry
// can be opened to edit, or removed.
//
// An agent is edited with the same field list the Library uses for an agent
// definition (def-fields' agentDefRegistry), as the loomcycle Web UI does. The
// other kinds have only a handful of fields, so each gets a small form rather
// than raw JSON.
//
// A webhook's auth names ENVIRONMENT VARIABLES, never their values: the form
// asks for a variable's name and nothing else.

const TITLES: Record<LocalKind, string> = {
  agents: "Agents",
  skills: "Skills",
  channels: "Channels",
  schedules: "Schedules",
  webhooks: "Webhooks",
};

const HINTS: Record<LocalKind, string> = {
  agents: "Run by a state as ./name; runs as <team>/name.",
  skills: "Granted to the team's own agents by listing ./name in their skills.",
  channels: "Needs no ACL entry: the team may always publish to and read its own channels.",
  schedules: "Ticks only while a walk of this team runs.",
  webhooks: "Answers only while a walk of this team runs, on the instance running it.",
};

export interface TeamOwnEditorProps {
  entries: TeamOwnEntry[];
  bodies: Record<LocalKind, Record<string, JsonObject>>;
  disabled?: boolean;
  onAdd: (kind: LocalKind, name: string) => string | undefined;
  onSet: (kind: LocalKind, name: string, body: JsonObject) => void;
  onRemove: (kind: LocalKind, name: string) => void;
  /** Rename an entry and every ./name reference to it; returns why not. */
  onRename?: (kind: LocalKind, from: string, to: string) => string | undefined;
  /** An entry to open, as "kind/name" (e.g. from a node's Edit link). A new
   *  object each time it is asked for, so asking again reopens it. */
  focus?: { key: string };
}

export function TeamOwnEditor({ entries, bodies, disabled, onAdd, onSet, onRemove, onRename, focus }: TeamOwnEditorProps) {
  const [open, setOpen] = useState<string | undefined>(focus?.key);
  useEffect(() => {
    if (focus) setOpen(focus.key);
  }, [focus]);
  const ownChannels = Object.keys(bodies.channels).sort().map((n) => `./${n}`);
  return (
    <section className="lb-wf-team lb-wf-team-own" aria-label="The team's own definitions">
      <h3 className="lb-wf-team__title">The team's own</h3>
      <p className="lb-wf-team__hint">
        Declared in this team and nowhere else. The graph names them as <code>./name</code>; a bare name is always the
        global entry. Changes are saved with the team.
      </p>
      {LOCAL_KINDS.map((kind) => (
        <div key={kind} className="lb-wf-team-own__kind" data-testid={`own-kind-${kind}`}>
          <h4 title={HINTS[kind]}>{TITLES[kind]}</h4>
          <ul>
            {entries
              .filter((e) => e.kind === kind)
              .map((e) => {
                const key = `${kind}/${e.name}`;
                return (
                  <li key={key} data-testid={`own-${kind}-${e.name}`}>
                    <div className="lb-wf-team-own__row">
                      <code>{e.ref}</code>
                      <span className="lb-wf-toolbar__spacer" />
                      <button
                        type="button"
                        className="lb-wf-btn"
                        aria-expanded={open === key}
                        aria-label={`Edit ${e.ref}`}
                        onClick={() => setOpen(open === key ? undefined : key)}
                      >
                        {open === key ? "Done" : "Edit"}
                      </button>
                      <button
                        type="button"
                        className="lb-wf-btn"
                        aria-label={`Remove ${e.ref}`}
                        disabled={disabled}
                        onClick={() => onRemove(kind, e.name)}
                      >
                        Remove
                      </button>
                    </div>
                    {e.facts.length > 0 && <div className="lb-wf-team-own__facts">{e.facts.join(" · ")}</div>}
                    {e.note && <div className="lb-wf-team__hint">{e.note}</div>}
                    {open === key && onRename && (
                      <RenameRow
                        current={e.name}
                        kind={kind}
                        disabled={disabled}
                        onRename={(to) => {
                          const why = onRename(kind, e.name, to);
                          if (!why) setOpen(`${kind}/${to}`);
                          return why;
                        }}
                      />
                    )}
                    {open === key && (
                      <BodyEditor
                        kind={kind}
                        body={bodies[kind][e.name] ?? {}}
                        channels={ownChannels}
                        disabled={disabled}
                        onChange={(b) => onSet(kind, e.name, b)}
                      />
                    )}
                  </li>
                );
              })}
          </ul>
          <AddRow kind={kind} disabled={disabled} onAdd={(name) => {
            const why = onAdd(kind, name);
            if (!why) setOpen(`${kind}/${name}`);
            return why;
          }} />
        </div>
      ))}
    </section>
  );
}

const RENAME_NOTES: Partial<Record<LocalKind, string>> = {
  agents: "Every state that runs it is updated.",
  skills: "Every agent of the team granted it is updated.",
  channels: "Every state, schedule, webhook and agent grant naming it is updated.",
  webhooks: "Its URL ends in its name: tell whoever sends to it.",
};

function RenameRow({
  current,
  kind,
  disabled,
  onRename,
}: {
  current: string;
  kind: LocalKind;
  disabled?: boolean;
  onRename: (to: string) => string | undefined;
}) {
  const [to, setTo] = useState(current);
  const [error, setError] = useState<string>();
  return (
    <form
      className="lb-wf-team-own__add"
      onSubmit={(e) => {
        e.preventDefault();
        setError(onRename(to.trim()));
      }}
    >
      <input className="lb-wf-input" aria-label="Rename to" value={to} disabled={disabled} onChange={(e) => setTo(e.target.value)} />
      <button type="submit" className="lb-wf-btn" disabled={disabled || !to.trim() || to.trim() === current}>
        Rename
      </button>
      {RENAME_NOTES[kind] && <div className="lb-wf-team__hint">{RENAME_NOTES[kind]}</div>}
      {error && <div className="lb-wf-finding lb-wf-finding--error">{error}</div>}
    </form>
  );
}

function AddRow({ kind, disabled, onAdd }: { kind: LocalKind; disabled?: boolean; onAdd: (name: string) => string | undefined }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  return (
    <form
      className="lb-wf-team-own__add"
      onSubmit={(e) => {
        e.preventDefault();
        const why = onAdd(name.trim());
        setError(why);
        if (!why) setName("");
      }}
    >
      <input
        className="lb-wf-input"
        aria-label={`New ${TITLES[kind].toLowerCase().replace(/s$/, "")} name`}
        placeholder="name"
        value={name}
        disabled={disabled}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="lb-wf-btn" disabled={disabled || !name.trim()}>
        Add
      </button>
      {error && <div className="lb-wf-finding lb-wf-finding--error">{error}</div>}
    </form>
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function obj(v: unknown): JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as JsonObject) : {};
}

/** A body with `key` set, or removed when the value is empty. */
function withField(body: JsonObject, key: string, value: JsonObject[string] | undefined): JsonObject {
  const { [key]: _old, ...rest } = body;
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return rest;
  return { ...rest, [key]: value };
}

function list(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function BodyEditor({
  kind,
  body,
  channels,
  disabled,
  onChange,
}: {
  kind: LocalKind;
  body: JsonObject;
  channels: string[];
  disabled?: boolean;
  onChange: (b: JsonObject) => void;
}) {
  const field = (label: string, control: React.ReactNode) => (
    <label className="lb-wf-field lb-wf-team-own__field">
      <span className="lb-wf-field__label">{label}</span>
      {control}
    </label>
  );
  const text = (key: string, label: string, placeholder = "") =>
    field(
      label,
      <input
        aria-label={label}
        value={str(body[key])}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(withField(body, key, e.target.value))}
      />,
    );
  const channelSelect = () =>
    field(
      "Publishes to",
      <select
        aria-label="Publishes to"
        value={str(body.channel)}
        disabled={disabled}
        onChange={(e) => onChange(withField(body, "channel", e.target.value))}
      >
        <option value="">— one of the team's own channels —</option>
        {channels.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>,
    );

  if (kind === "agents") {
    return (
      <div className="lb-wf-team-own__editor">
        <FoldedFieldList
          registry={agentDefRegistry}
          value={body as DefValue}
          onChange={(next) => onChange(next as JsonObject)}
          disabled={disabled}
          hideToolbar
        />
      </div>
    );
  }

  if (kind === "skills") {
    const tools = Array.isArray(body.tools) ? body.tools.filter((t): t is string => typeof t === "string") : [];
    return (
      <div className="lb-wf-team-own__editor">
        {text("description", "Description")}
        {field(
          "Tools it needs",
          <input
            aria-label="Tools it needs"
            value={tools.join(", ")}
            placeholder="e.g. Document, WebSearch"
            disabled={disabled}
            onChange={(e) => onChange(withField(body, "tools", list(e.target.value)))}
          />,
        )}
        {field(
          "Body",
          <textarea
            aria-label="Body"
            rows={6}
            value={str(body.body)}
            disabled={disabled}
            onChange={(e) => onChange({ ...body, body: e.target.value })}
          />,
        )}
      </div>
    );
  }

  if (kind === "channels") {
    const num = (key: string, label: string) =>
      field(
        label,
        <input
          aria-label={label}
          type="number"
          min={0}
          value={typeof body[key] === "number" ? String(body[key]) : ""}
          disabled={disabled}
          onChange={(e) => onChange(withField(body, key, e.target.value === "" ? undefined : Number(e.target.value)))}
        />,
      );
    return (
      <div className="lb-wf-team-own__editor">
        {field(
          "Scope",
          <select aria-label="Scope" value={str(body.scope)} disabled={disabled} onChange={(e) => onChange({ ...body, scope: e.target.value })}>
            <option value="tenant">tenant — shared by the team's walks</option>
            <option value="user">user — one per user</option>
          </select>,
        )}
        {field(
          "Semantic",
          <select
            aria-label="Semantic"
            value={str(body.semantic)}
            disabled={disabled}
            onChange={(e) => onChange(withField(body, "semantic", e.target.value))}
          >
            <option value="">queue (default)</option>
            <option value="queue">queue</option>
            <option value="topic">topic</option>
          </select>,
        )}
        {num("default_ttl", "Message TTL (seconds)")}
        {num("max_messages", "Max messages")}
        <label className="lb-wf-form-editor__check">
          <input
            type="checkbox"
            checked={body.hold === true}
            disabled={disabled}
            onChange={(e) => onChange(withField(body, "hold", e.target.checked ? true : undefined))}
          />
          hold — store messages, deliver none until released
        </label>
        {text("description", "Description")}
      </div>
    );
  }

  if (kind === "schedules") {
    return (
      <div className="lb-wf-team-own__editor">
        {text("schedule", "Cadence", "@hourly, @every 5m, or 0 9 * * *")}
        {channelSelect()}
        <PayloadField value={body.payload} disabled={disabled} onChange={(p) => onChange(withField(body, "payload", p))} />
      </div>
    );
  }

  // webhooks
  const auth = obj(body.auth);
  const authKind = str(auth.kind) || "hmac";
  const secretField = WEBHOOK_SECRET_FIELD[authKind];
  const setAuth = (next: JsonObject) => onChange({ ...body, auth: next });
  return (
    <div className="lb-wf-team-own__editor">
      {field(
        "Auth",
        <select
          aria-label="Auth"
          value={authKind}
          disabled={disabled}
          onChange={(e) => {
            // The secret's name moves to the field the new kind reads.
            const old = secretField ? str(auth[secretField]) : "";
            const nextField = WEBHOOK_SECRET_FIELD[e.target.value];
            const { signing_secret_env: _s, bearer_token_env: _b, ...rest } = auth;
            setAuth({ ...rest, kind: e.target.value, ...(nextField ? { [nextField]: old } : {}) });
          }}
        >
          <option value="hmac">hmac — signed requests</option>
          <option value="bearer">bearer — a token header</option>
          <option value="none">none — where the operator allows it</option>
        </select>,
      )}
      {secretField &&
        field(
          authKind === "hmac" ? "Signing secret env var" : "Token env var",
          <input
            aria-label={authKind === "hmac" ? "Signing secret env var" : "Token env var"}
            value={str(auth[secretField])}
            placeholder="NAME_OF_ENV_VAR — never the secret itself"
            disabled={disabled}
            onChange={(e) => setAuth({ ...auth, [secretField]: e.target.value.trim() })}
          />,
        )}
      {channelSelect()}
      {field(
        "Attribute to user (JSONPath, optional)",
        <input
          aria-label="Attribute to user"
          value={str(obj(body.payload_mapping).user_id)}
          placeholder="$.sender.id — needed for a user-scoped channel"
          disabled={disabled}
          onChange={(e) =>
            onChange(withField(body, "payload_mapping", e.target.value.trim() ? { user_id: e.target.value.trim() } : undefined))
          }
        />,
      )}
    </div>
  );
}

/** A schedule's payload: any JSON, kept as text until it parses. */
function PayloadField({
  value,
  disabled,
  onChange,
}: {
  value: JsonObject[string] | undefined;
  disabled?: boolean;
  onChange: (v: JsonObject[string] | undefined) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <label className="lb-wf-field lb-wf-team-own__field">
      <span className="lb-wf-field__label">Payload (JSON, optional)</span>
      <textarea
        aria-label="Payload"
        rows={4}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!e.target.value.trim()) {
            setBad(false);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && <span className="lb-wf-finding lb-wf-finding--error">not valid JSON yet — the last valid payload is kept</span>}
    </label>
  );
}
