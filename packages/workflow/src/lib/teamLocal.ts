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

/** The team's declared variables, name → default. */
export function teamVars(model: CanvasModel): Record<string, string> {
  const v = obj(model.source.vars);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v ?? {})) out[k] = typeof val === "string" ? val : "";
  return out;
}

/** The names the team declares under local.<kind>, sorted. */
export function localNames(model: CanvasModel, kind: LocalKind): string[] {
  return Object.keys(obj(obj(model.source.local)?.[kind]) ?? {}).sort();
}

/** One declared entry's body, or undefined. */
export function localEntry(model: CanvasModel, kind: LocalKind, name: string): JsonObject | undefined {
  return obj(obj(obj(model.source.local)?.[kind])?.[name]);
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

/** Mirrors validateVars + validateLocal (+ CheckLocalRefs), in that order.
 *  Messages are phrased as teamgraph's, minus its "team definition:" prefix. */
export function validateTeamLocal(
  source: JsonObject,
  agentRefs: readonly { state: string; field: string; agent: string }[],
  channelRefs: readonly { state: string; field: string; channel: string }[],
): string[] {
  const out: string[] = [];

  // ---- vars ----
  const rawVars = source.vars;
  if (rawVars !== undefined && rawVars !== null) {
    const vars = obj(rawVars);
    if (!vars) out.push("vars must be an object of name → default text");
    else {
      const names = Object.keys(vars).sort();
      if (names.length > MAX_VARS) out.push(`vars declares ${names.length} variables, more than the maximum ${MAX_VARS}`);
      for (const name of names) {
        if (!NAME_RE.test(name)) out.push(`vars key ${JSON.stringify(name)} must match [a-zA-Z0-9_-]{1,64}`);
        const v = vars[name];
        if (typeof v !== "string") out.push(`vars ${JSON.stringify(name)}: the default must be text`);
        else {
          const why = varValueError(v);
          if (why) out.push(`vars ${JSON.stringify(name)}: ${why}`);
        }
      }
    }
  }

  // ---- local ----
  const local = source.local;
  if (local === undefined || local === null) {
    // No local block: any "./" reference names nothing.
  } else if (!obj(local)) {
    out.push('local: must be an object of kinds, e.g. {"agents": {...}}');
    return out;
  }
  const block = obj(local) ?? {};
  for (const kind of Object.keys(block).sort()) {
    if (!(LOCAL_KINDS as readonly string[]).includes(kind)) {
      out.push(
        `local: unknown kind ${JSON.stringify(kind)} — a team may declare only local "agents", "skills", "channels", "schedules" and "webhooks"`,
      );
    }
  }
  const declared = (kind: LocalKind) => Object.keys(obj(block[kind]) ?? {}).sort();
  for (const kind of LOCAL_KINDS) {
    const names = declared(kind);
    if (names.length > LIMITS[kind]) {
      out.push(`local.${kind} declares ${names.length} ${kind}, more than the maximum ${LIMITS[kind]}`);
    }
    for (const name of names) {
      if (!NAME_RE.test(name)) {
        out.push(
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
        out.push(
          `channels.${side}: ${JSON.stringify(entry)} names one of the team's own channels, which the team may always ` +
            "publish to and read — remove it from the ACL",
        );
      }
    }
  }

  for (const r of agentRefs) {
    const name = localRef(r.agent);
    if (name !== undefined && !has("agents", name)) {
      out.push(
        `state ${JSON.stringify(r.state)} ${r.field}: ${JSON.stringify(r.agent)} names a local agent the team does not declare under local.agents (${listed("agents")})`,
      );
    }
  }
  for (const r of channelRefs) {
    const name = localRef(r.channel);
    if (name !== undefined && !has("channels", name)) {
      out.push(
        `state ${JSON.stringify(r.state)} ${r.field}: ${JSON.stringify(r.channel)} names a channel the team does not declare under local.channels (${listed("channels")})`,
      );
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
        out.push(
          `${where}: channel ${JSON.stringify(channel)} must name one of the team's own channels as "./<name>" — a team's own ${KIND_WORD[kind]} publishes only into the team`,
        );
      } else if (!has("channels", target)) {
        out.push(`${where}: channel ${JSON.stringify(channel)} names a channel the team does not declare under local.channels (${listed("channels")})`);
      }
    }
  }
  return out;
}
