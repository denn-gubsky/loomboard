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

import { CHANNEL_LAYOUT_PREFIX, handlerOf, patchHandler, storedDerivedPosition, type CanvasModel, type JsonObject } from "./model";
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

/** Every place a definition can name a team's own entry of `kind`, rewritten
 *  from "./from" to "./to":
 *
 *   agents    a state's agent, agents[], consolidator, fanout.agent / agents[]
 *   skills    the team's own agents' `skills` grants
 *   channels  a state's source / sink / channel / publish channel, the team's
 *             own schedules' and webhooks' target, and the team's own agents'
 *             `channels` grants (publish / subscribe)
 *
 *  Schedules and webhooks are named by nothing in the definition; a webhook's
 *  URL ends in its name, so a sender must be told of the new one. Refused (the
 *  model comes back unchanged) when `to` is not a free, valid name. */
export function renameLocal(model: CanvasModel, kind: LocalKind, from: string, to: string): CanvasModel {
  const entries = localKind(model, kind);
  if (!(from in entries) || from === to || localNameError(model, kind, to)) return model;
  const oldRef = `${LOCAL_REF_PREFIX}${from}`;
  const newRef = `${LOCAL_REF_PREFIX}${to}`;
  const swap = (v: unknown) => (v === oldRef ? newRef : v);
  const swapList = (v: unknown) => (Array.isArray(v) ? v.map(swap) : v);

  // The kind itself, keeping the entries' order.
  let next = withKind(
    model,
    kind,
    Object.fromEntries(Object.entries(entries).map(([k, v]) => [k === from ? to : k, v])) as Record<string, JsonObject>,
  );

  if (kind === "agents" || kind === "channels") {
    next = {
      ...next,
      nodes: next.nodes.map((n) => {
        if (n.opaque) return n;
        const h = handlerOf(n);
        const patch: Record<string, JsonObject[string]> = {};
        if (kind === "agents") {
          if (h.agent === oldRef) patch.agent = newRef;
          if (h.consolidator === oldRef) patch.consolidator = newRef;
          if (Array.isArray(h.agents) && h.agents.includes(oldRef)) patch.agents = swapList(h.agents) as JsonObject[string];
          const f = obj(h.fanout);
          if (f && (f.agent === oldRef || (Array.isArray(f.agents) && f.agents.includes(oldRef)))) {
            patch.fanout = { ...f, ...(f.agent === oldRef ? { agent: newRef } : {}), ...(Array.isArray(f.agents) ? { agents: swapList(f.agents) as JsonObject[string] } : {}) };
          }
        } else {
          for (const key of ["source", "sink", "publish"] as const) {
            const b = obj(h[key]);
            if (b?.channel === oldRef) patch[key] = { ...b, channel: newRef };
          }
          if (h.channel === oldRef) patch.channel = newRef;
        }
        return Object.keys(patch).length ? patchHandler(n, patch) : n;
      }),
    };
  }

  // References from the team's own entries.
  const rewrite = (k: LocalKind, fn: (b: JsonObject) => JsonObject) => {
    const cur = localKind(next, k);
    let changed = false;
    const out: Record<string, JsonObject> = {};
    for (const [name, b] of Object.entries(cur)) {
      const nb = fn(b);
      if (nb !== b) changed = true;
      out[name] = nb;
    }
    if (changed) next = withKind(next, k, out);
  };
  if (kind === "skills") {
    rewrite("agents", (b) => (Array.isArray(b.skills) && b.skills.includes(oldRef) ? { ...b, skills: swapList(b.skills) as JsonObject[string] } : b));
  }
  if (kind === "channels") {
    for (const k of ["schedules", "webhooks"] as const) {
      rewrite(k, (b) => (b.channel === oldRef ? { ...b, channel: newRef } : b));
    }
    rewrite("agents", (b) => {
      const ch = obj(b.channels);
      if (!ch) return b;
      const pub = swapList(ch.publish);
      const sub = swapList(ch.subscribe);
      if (JSON.stringify(pub) === JSON.stringify(ch.publish) && JSON.stringify(sub) === JSON.stringify(ch.subscribe)) return b;
      return { ...b, channels: { ...ch, ...(pub !== undefined ? { publish: pub as JsonObject[string] } : {}), ...(sub !== undefined ? { subscribe: sub as JsonObject[string] } : {}) } };
    });
    // The channel node keeps where it was dragged.
    const oldKey = `${CHANNEL_LAYOUT_PREFIX}${oldRef}`;
    const pos = storedDerivedPosition(next, oldKey);
    if (pos) {
      next = {
        ...next,
        layoutDirty: true,
        derivedPositions: { ...(next.derivedPositions ?? {}), [`${CHANNEL_LAYOUT_PREFIX}${newRef}`]: pos },
        channelsRemoved: [...new Set([...(next.channelsRemoved ?? []), oldKey])],
      };
    }
  }
  return next;
}
