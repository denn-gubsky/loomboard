// Editing a team's own definitions on the canvas (RFC DV): add, change and
// remove the agents, skills, channels, schedules and webhooks under `local`.
//
// Every edit lands in `model.localPatch`, one kind at a time, which a save
// writes back wholesale per kind (lib/model.ts) — the runtime's rule for a
// fork. Nothing here renames: removing an entry leaves the graph's "./name"
// references alone, and validateModel then names each one that broke.
//
// `localBodyFindings` mirrors what the AUTHORING call refuses about a body
// (TeamDef create / fork, checked live on 1.104.0) — not teamgraph.Validate,
// which is why it is a separate list and has no shared fixtures: a channel's
// scope, a skill's body, a schedule's cadence, a webhook's auth. (Where a
// schedule or webhook publishes is teamgraph's rule, reported by validateModel.)
//
// Pure: no React, no network.

import type { CanvasModel, JsonObject } from "./model";
import { LOCAL_REF_PREFIX, localKind, localNames, type LocalKind } from "./teamLocal";
import type { Finding } from "./validate";

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Why `name` cannot be added as a `kind`, or undefined. */
export function localNameError(model: CanvasModel, kind: LocalKind, name: string): string | undefined {
  if (!NAME_RE.test(name)) return "a name is one segment of A-Z a-z 0-9 _ -, at most 64 characters";
  if (localNames(model, kind).includes(name)) return `the team already declares ${JSON.stringify(name)}`;
  return undefined;
}

/** A body the runtime accepts as a start, for each kind. A schedule or a
 *  webhook targets the team's first own channel, when it has one. */
export function defaultLocalBody(model: CanvasModel, kind: LocalKind): JsonObject {
  const channel = localNames(model, "channels")[0];
  const target = channel ? `${LOCAL_REF_PREFIX}${channel}` : "";
  switch (kind) {
    case "agents":
      return {};
    case "skills":
      return { body: "", description: "" };
    case "channels":
      return { scope: "tenant" };
    case "schedules":
      return { schedule: "@hourly", channel: target };
    case "webhooks":
      return { auth: { kind: "hmac", signing_secret_env: "" }, channel: target };
  }
}

function withKind(model: CanvasModel, kind: LocalKind, entries: Record<string, JsonObject>): CanvasModel {
  return { ...model, localPatch: { ...(model.localPatch ?? {}), [kind]: entries } };
}

export function addLocal(model: CanvasModel, kind: LocalKind, name: string, body?: JsonObject): CanvasModel {
  if (localNameError(model, kind, name)) return model;
  return withKind(model, kind, { ...localKind(model, kind), [name]: body ?? defaultLocalBody(model, kind) });
}

export function setLocal(model: CanvasModel, kind: LocalKind, name: string, body: JsonObject): CanvasModel {
  const entries = localKind(model, kind);
  if (!(name in entries)) return model;
  return withKind(model, kind, { ...entries, [name]: body });
}

export function removeLocal(model: CanvasModel, kind: LocalKind, name: string): CanvasModel {
  const entries = localKind(model, kind);
  if (!(name in entries)) return model;
  const { [name]: _gone, ...rest } = entries;
  return withKind(model, kind, rest);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function obj(v: unknown): JsonObject | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as JsonObject) : undefined;
}

/** The env var a webhook's auth kind reads, by kind. */
export const WEBHOOK_SECRET_FIELD: Record<string, "signing_secret_env" | "bearer_token_env" | undefined> = {
  hmac: "signing_secret_env",
  bearer: "bearer_token_env",
  none: undefined,
};

/** What the runtime's authoring call refuses about each body. Errors: a save
 *  would be refused. Phrased as the runtime phrases them. */
export function localBodyFindings(model: CanvasModel): Finding[] {
  const out: Finding[] = [];
  const err = (kind: LocalKind, name: string, message: string) =>
    out.push({ level: "error", message: `local.${kind}[${JSON.stringify(name)}]: ${message}` });

  for (const [name, b] of Object.entries(localKind(model, "skills"))) {
    if (!str(b.body).trim()) err("skills", name, "body is required and must contain non-whitespace content");
  }
  for (const [name, b] of Object.entries(localKind(model, "channels"))) {
    const scope = str(b.scope);
    if (scope !== "tenant" && scope !== "user") {
      err("channels", name, "scope must be tenant (shared by the team's walks in its tenant) or user (one per user)");
    }
  }
  for (const [name, b] of Object.entries(localKind(model, "schedules"))) {
    if (!str(b.schedule).trim()) err("schedules", name, "a schedule needs a cadence, e.g. @hourly or a five-field cron");
  }
  for (const [name, b] of Object.entries(localKind(model, "webhooks"))) {
    const auth = obj(b.auth) ?? {};
    const kind = str(auth.kind) || "hmac";
    if (!(kind in WEBHOOK_SECRET_FIELD)) err("webhooks", name, `auth.kind must be hmac, bearer or none, got ${JSON.stringify(kind)}`);
    const field = WEBHOOK_SECRET_FIELD[kind];
    if (field && !str(auth[field]).trim()) err("webhooks", name, `auth.kind=${kind} requires auth.${field}`);
  }
  return out;
}
