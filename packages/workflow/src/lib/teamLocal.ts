// A team's own definitions and variables (loomcycle RFC DV, 1.104.0).
//
// A TeamDef may carry two top-level sections beside its graph:
//
//   vars   name → default text. States read them as ${var.name}; a start may
//          set any declared one for that walk.
//   local  what the team declares for itself — agents, skills, channels,
//          schedules, webhooks. Referenced from the graph as "./name"; a bare
//          name always means the GLOBAL entry, even when the team declares
//          one of the same name.
//
// The canvas edits neither yet, so both round-trip untouched (lib/model keeps
// every top-level key it does not own). This module reads them, and mirrors
// the store-free rules teamgraph applies to them (vars.go, local.go,
// localchannels.go, localschedules.go, localwebhooks.go at v1.104.0), so a
// definition the runtime refuses is not drawn as valid.
//
// Not mirrored — refused only by the authoring call, with its own message: an
// agent or skill body's contents, a skill's tool grants against an agent's,
// a schedule's cadence, payload size and a webhook's auth fields.
//
// Pure: no React, no network.

import type { CanvasModel, JsonObject } from "./model";

export const LOCAL_REF_PREFIX = "./";
export const LOCAL_KINDS = ["agents", "skills", "channels", "schedules", "webhooks"] as const;
export type LocalKind = (typeof LOCAL_KINDS)[number];

const LIMITS: Record<LocalKind, number> = { agents: 64, skills: 64, channels: 64, schedules: 16, webhooks: 16 };
const KIND_WORD: Record<LocalKind, string> = {
  agents: "agent",
  skills: "skill",
  channels: "channel",
  schedules: "schedule",
  webhooks: "webhook",
};
export const MAX_VARS = 64;
export const MAX_VAR_VALUE_BYTES = 4096;
/** varNameRe: also a local name's grammar — one segment of the team-name. */
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
/** validate.go secretNamespaces. */
const SECRET_NAMESPACES = ["${run.credentials.", "${run.user_bearer"];

function obj(v: unknown): JsonObject | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as JsonObject) : undefined;
}

/** "./reviewer" → "reviewer"; undefined for a bare (global) name. */
export function localRef(ref: string): string | undefined {
  return ref.startsWith(LOCAL_REF_PREFIX) ? ref.slice(LOCAL_REF_PREFIX.length) : undefined;
}

/** The team's declared variables, name → default — the operator's edit if
 *  there is one, otherwise what the definition carries. */
export function teamVars(model: CanvasModel): Record<string, string> {
  if (model.varsPatch) return model.varsPatch;
  const v = obj(model.source.vars);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v ?? {})) out[k] = typeof val === "string" ? val : "";
  return out;
}

/** The names the team declares under local.<kind>, sorted. */
export function localNames(model: CanvasModel, kind: LocalKind): string[] {
  return Object.keys(localKind(model, kind)).sort();
}

/** One declared entry's body, or undefined. */
export function localEntry(model: CanvasModel, kind: LocalKind, name: string): JsonObject | undefined {
  return obj(localKind(model, kind)[name]);
}

/** One kind's entries as they stand: the operator's edit, else the saved. */
export function localKind(model: CanvasModel, kind: LocalKind): Record<string, JsonObject> {
  const patched = model.localPatch?.[kind];
  if (patched) return patched;
  const saved = obj(obj(model.source.local)?.[kind]) ?? {};
  const out: Record<string, JsonObject> = {};
  for (const [k, v] of Object.entries(saved)) out[k] = obj(v) ?? {};
  return out;
}

/** The `local` block as it stands, for the checks: the saved one with every
 *  edited kind replaced. Undefined when the team has none. */
export function effectiveLocal(model: CanvasModel): JsonObject | undefined {
  const saved = model.source.local;
  if (!model.localPatch) return obj(saved) ?? (saved as JsonObject | undefined);
  const out: JsonObject = { ...(obj(saved) ?? {}) };
  for (const kind of LOCAL_KINDS) if (model.localPatch[kind]) out[kind] = model.localPatch[kind]!;
  return out;
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** CheckVarValue: what a variable's value must satisfy when written down — as
 *  a declared default, or by the person starting a walk. Undefined when fine. */
export function varValueError(value: string): string | undefined {
  const n = utf8Bytes(value);
  if (n > MAX_VAR_VALUE_BYTES) return `the value is ${n} bytes, more than the maximum ${MAX_VAR_VALUE_BYTES}`;
  if (value.includes("{{") || value.includes("}}")) {
    return "the value contains {{ or }} — a variable may not carry a prompt placeholder";
  }
  if (SECRET_NAMESPACES.some((ns) => value.includes(ns))) {
    return "the value names the credentials namespace — variables are non-secret by construction";
  }
  return undefined;
}

/** One refusal of the vars / local rules, with where it is: `path` in the
 *  definition, or, for a state's reference, the state and its field. */
export interface TeamLocalIssue {
  message: string;
  path: (string | number)[];
  state?: string;
  field?: string;
}

/** Mirrors validateVars + validateLocal (+ CheckLocalRefs), in that order.
 *  Messages are phrased as teamgraph's, minus its "team definition:" prefix. */
export function validateTeamLocal(
  source: JsonObject,
  agentRefs: readonly { state: string; field: string; agent: string }[],
  channelRefs: readonly { state: string; field: string; channel: string }[],
): TeamLocalIssue[] {
  const out: TeamLocalIssue[] = [];
  const at = (path: (string | number)[]) => (message: string) => out.push({ message, path });

  // ---- vars ----
  const rawVars = source.vars;
  if (rawVars !== undefined && rawVars !== null) {
    const vars = obj(rawVars);
    if (!vars) at(["vars"])("vars must be an object of name → default text");
    else {
      const names = Object.keys(vars).sort();
      if (names.length > MAX_VARS) at(["vars"])(`vars declares ${names.length} variables, more than the maximum ${MAX_VARS}`);
      for (const name of names) {
        if (!NAME_RE.test(name)) at(["vars", name])(`vars key ${JSON.stringify(name)} must match [a-zA-Z0-9_-]{1,64}`);
        const v = vars[name];
        if (typeof v !== "string") at(["vars", name])(`vars ${JSON.stringify(name)}: the default must be text`);
        else {
          const why = varValueError(v);
          if (why) at(["vars", name])(`vars ${JSON.stringify(name)}: ${why}`);
        }
      }
    }
  }

  // ---- local ----
  const local = source.local;
  if (local === undefined || local === null) {
    // No local block: any "./" reference names nothing.
  } else if (!obj(local)) {
    at(["local"])('local: must be an object of kinds, e.g. {"agents": {...}}');
    return out;
  }
  const block = obj(local) ?? {};
  for (const kind of Object.keys(block).sort()) {
    if (!(LOCAL_KINDS as readonly string[]).includes(kind)) {
      at(["local", kind])(
        `local: unknown kind ${JSON.stringify(kind)} — a team may declare only local "agents", "skills", "channels", "schedules" and "webhooks"`,
      );
    }
  }
  const declared = (kind: LocalKind) => Object.keys(obj(block[kind]) ?? {}).sort();
  for (const kind of LOCAL_KINDS) {
    const names = declared(kind);
    if (names.length > LIMITS[kind]) {
      at(["local", kind])(`local.${kind} declares ${names.length} ${kind}, more than the maximum ${LIMITS[kind]}`);
    }
    for (const name of names) {
      if (!NAME_RE.test(name)) {
        at(["local", kind, name])(
          `local.${kind}: local ${KIND_WORD[kind]} name ${JSON.stringify(name)} must be one segment of A-Z a-z 0-9 _ -, at most 64 characters`,
        );
      }
    }
  }
  const has = (kind: LocalKind, name: string) => declared(kind).includes(name);
  const listed = (kind: LocalKind) => {
    const names = declared(kind);
    return names.length ? `declared: ${names.join(", ")}` : "it declares none";
  };

  // A team's own channel needs no ACL entry, and may not have one.
  const acl = obj(source.channels);
  for (const side of ["publish", "subscribe"] as const) {
    const list = Array.isArray(acl?.[side]) ? (acl![side] as unknown[]) : [];
    for (const entry of list) {
      if (typeof entry === "string" && entry.trim().startsWith(LOCAL_REF_PREFIX)) {
        at(["channels", side])(
          `channels.${side}: ${JSON.stringify(entry)} names one of the team's own channels, which the team may always ` +
            "publish to and read — remove it from the ACL",
        );
      }
    }
  }

  for (const r of agentRefs) {
    const name = localRef(r.agent);
    if (name !== undefined && !has("agents", name)) {
      out.push({
        state: r.state,
        field: r.field,
        path: [],
        message: `state ${JSON.stringify(r.state)} ${r.field}: ${JSON.stringify(r.agent)} names a local agent the team does not declare under local.agents (${listed("agents")})`,
      });
    }
  }
  for (const r of channelRefs) {
    const name = localRef(r.channel);
    if (name !== undefined && !has("channels", name)) {
      out.push({
        state: r.state,
        field: r.field === "channel" ? "channel" : `${r.field}.channel`,
        path: [],
        message: `state ${JSON.stringify(r.state)} ${r.field}: ${JSON.stringify(r.channel)} names a channel the team does not declare under local.channels (${listed("channels")})`,
      });
    }
  }
  // A team's own schedule or webhook publishes only into the team.
  for (const kind of ["schedules", "webhooks"] as const) {
    for (const name of declared(kind)) {
      const ch = obj(obj(block[kind])?.[name])?.channel;
      const channel = typeof ch === "string" ? ch : "";
      const target = localRef(channel);
      const where = `local.${kind}[${JSON.stringify(name)}]`;
      if (target === undefined) {
        at(["local", kind, name, "channel"])(
          `${where}: channel ${JSON.stringify(channel)} must name one of the team's own channels as "./<name>" — a team's own ${KIND_WORD[kind]} publishes only into the team`,
        );
      } else if (!has("channels", target)) {
        at(["local", kind, name, "channel"])(`${where}: channel ${JSON.stringify(channel)} names a channel the team does not declare under local.channels (${listed("channels")})`);
      }
    }
  }
  return out;
}

/** What the team declares for itself, as the team pane lists it: one row per
 *  entry, with the few facts an operator reads it for. Read-only — the
 *  canvas does not edit `local` yet. */
export interface TeamOwnEntry {
  kind: LocalKind;
  name: string;
  /** How the graph refers to it: "./name". */
  ref: string;
  /** Short facts, e.g. "ollama-local/ornith-1.5:35b", "scope user". */
  facts: string[];
  /** Something the operator should know, e.g. a name it shadows. */
  note?: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Every entry the team declares, by kind. `globalAgents` is the runtime's
 *  agent list, for the one consequence a team's own agent has on others: a
 *  name a model writes in the Agent tool resolves to the team's agent first,
 *  for every agent in the walk (RFC DV). */
export function teamOwnEntries(model: CanvasModel, team: string, globalAgents: readonly string[] = []): TeamOwnEntry[] {
  const out: TeamOwnEntry[] = [];
  const shadowed = new Set(globalAgents);
  for (const kind of LOCAL_KINDS) {
    for (const name of localNames(model, kind)) {
      const b = localEntry(model, kind, name) ?? {};
      const facts: string[] = [];
      let note: string | undefined;
      if (kind === "agents") {
        const pin = [str(b.provider), str(b.model)].filter(Boolean).join("/");
        facts.push(pin || (str(b.tier) ? `tier ${str(b.tier)}` : "default model"));
        const tools = Array.isArray(b.tools) ? b.tools.filter((t): t is string => typeof t === "string") : [];
        facts.push(tools.length ? `tools: ${tools.join(", ")}` : "no tools");
        const skills = Array.isArray(b.skills) ? b.skills.filter((t): t is string => typeof t === "string") : [];
        if (skills.length) facts.push(`skills: ${skills.join(", ")}`);
        facts.push(`runs as ${team}/${name}`);
        if (shadowed.has(name)) {
          note =
            `A global agent is also named "${name}". Inside this team's walks, an Agent-tool call to "${name}" — from any ` +
            "agent in the walk — runs this one.";
        }
      } else if (kind === "skills") {
        if (str(b.description)) facts.push(str(b.description));
        const tools = Array.isArray(b.tools) ? b.tools.filter((t): t is string => typeof t === "string") : [];
        if (tools.length) facts.push(`needs: ${tools.join(", ")}`);
      } else if (kind === "channels") {
        facts.push(`scope ${str(b.scope) || "tenant"}`);
        if (b.hold === true) facts.push("held");
        if (str(b.description)) facts.push(str(b.description));
      } else if (kind === "schedules") {
        facts.push(str(b.schedule), `→ ${str(b.channel)}`);
        note = "Ticks only while a walk of this team runs.";
      } else if (kind === "webhooks") {
        const auth = obj(b.auth) ?? {};
        const kindOfAuth = str(auth.kind) || "hmac";
        const env = str(auth.signing_secret_env) || str(auth.bearer_token_env);
        facts.push(`POST /v1/_teams/{tenant}/${team}/webhooks/${name}`, `→ ${str(b.channel)}`, `auth ${kindOfAuth}${env ? ` (${env})` : ""}`);
        note = "Open only while a walk of this team runs, and only on the instance running it; otherwise 404.";
      }
      out.push({ kind, name, ref: `${LOCAL_REF_PREFIX}${name}`, facts: facts.filter(Boolean), note });
    }
  }
  return out;
}
