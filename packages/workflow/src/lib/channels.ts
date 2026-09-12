// What a definition NAMES but does not contain — the channel half.
//
// Mirrors loomcycle's `teamgraph/refs.go` and the ACL half of
// `teamdef_preflight.go`. WHY the canvas needs its own copy: a Starter whose
// channel is not granted in `Definition.Channels` is REFUSED at create/fork,
// not at run. Without this the operator authors a graph, hits Save, and gets a
// server error about a field that is on no node — the team ACL lives on the
// workflow, not on the state that broke.
//
// Deliberately NOT part of validateModel. That function mirrors
// `teamgraph.Validate`, and the shared fixture set asserts its verdict against
// the real Go validator — but the ACL check lives in the TOOL's preflight, not
// in Validate, so a definition can fail this and pass that. Folding them
// together would make the fixtures wrong about one or the other.
//
// Pure: no React, no network.

import type { CanvasModel } from "./model";
import { handlerOf } from "./model";
import type { Finding } from "./validate";

export type ChannelSide = "publish" | "subscribe";

/** One channel a definition names, and why. `state` and `field` are carried so
 *  a finding can point at the line the author wrote. */
export interface ChannelRef {
  channel: string;
  side: ChannelSide;
  state: string;
  field: "source" | "sink" | "channel";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Every channel the definition names, in node order, **duplicates kept**.
 *
 *  Kept because the same channel used as a source in one node and a sink in
 *  another needs BOTH grants, and collapsing them would hide one. */
export function channelRefs(model: CanvasModel): ChannelRef[] {
  const out: ChannelRef[] = [];
  for (const n of model.nodes) {
    const h = handlerOf(n);
    const source = obj(h.source);
    if (source && str(source.channel)) {
      out.push({ channel: str(source.channel), side: "subscribe", state: n.id, field: "source" });
    }
    const sink = obj(h.sink);
    if (sink && str(sink.channel)) {
      out.push({ channel: str(sink.channel), side: "publish", state: n.id, field: "sink" });
    }
    if (str(h.channel)) {
      out.push({ channel: str(h.channel), side: "publish", state: n.id, field: "channel" });
    }
  }
  return out;
}

/** The team's grant list for one side, or [] when it declares no ACL. */
export function grantList(model: CanvasModel, side: ChannelSide): string[] {
  const ch = obj(model.channelsPatch ?? model.source.channels);
  const raw = ch?.[side];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** Mirrors `builtin.channelAllowed` — the ONE matcher a Starter's channels are
 *  resolved against.
 *
 *  Two behaviours worth keeping exactly: a trailing `/*` is a PREFIX wildcard
 *  that matches `findings/alpha` but not `findings` itself, and a name
 *  containing `..` or `//` is refused outright before any match. That second
 *  rule is defence-in-depth against a path-traversal name slipping through a
 *  wildcard grant, and a mirror that dropped it would show an operator a green
 *  canvas for an ACL the runtime rejects. */
export function channelAllowed(name: string, allowlist: readonly string[]): boolean {
  const n = name.trim();
  if (n.includes("..") || n.includes("//")) return false;
  for (const raw of allowlist) {
    const pat = raw.trim();
    if (pat === n) return true;
    if (pat.endsWith("/*")) {
      const prefix = pat.slice(0, -1); // keeps the trailing "/"
      if (n.startsWith(prefix) && n.length > prefix.length) return true;
    }
  }
  return false;
}

/** The distinct channels this definition touches, with the sides it needs. */
export function channelsInUse(model: CanvasModel): { channel: string; sides: ChannelSide[] }[] {
  const bySide = new Map<string, Set<ChannelSide>>();
  for (const r of channelRefs(model)) {
    const set = bySide.get(r.channel) ?? new Set<ChannelSide>();
    set.add(r.side);
    bySide.set(r.channel, set);
  }
  return [...bySide.entries()]
    .map(([channel, sides]) => ({ channel, sides: [...sides].sort() }))
    .sort((a, b) => a.channel.localeCompare(b.channel));
}

/** Findings for the team ACL — the check that blocks a SAVE.
 *
 *  Errors rather than warnings: `op=create` and `op=fork` refuse outright, so
 *  a canvas that let the operator press Save would simply relay a server error
 *  a moment later. */
export function aclFindings(model: CanvasModel): Finding[] {
  const out: Finding[] = [];
  const declaresACL =
    !!model.channelsPatch ||
    !!obj(model.source.channels);

  // OPAQUE nodes are exempt, and this is consistent with the runtime rather
  // than a softening of it: Go refuses an unknown handler kind in
  // teamgraph.Validate, which runs BEFORE the tool's channel preflight — so it
  // never ACL-checks a node like this either. Flagging one here would paint a
  // graph red that a newer runtime accepts, which decision 3 exists to prevent.
  const opaque = new Set(model.nodes.filter((n) => n.opaque).map((n) => n.id));

  for (const ref of channelRefs(model)) {
    if (opaque.has(ref.state)) continue;
    if (channelAllowed(ref.channel, grantList(model, ref.side))) continue;
    out.push({
      level: "error",
      nodeId: ref.state,
      // Prefixed with the node, matching teamgraph's preflight wording — the
      // findings list puts these beside validateModel's, and one without a
      // subject reads as though it belongs to the graph rather than a node.
      message: declaresACL
        ? `state ${JSON.stringify(ref.state)} uses channel ${JSON.stringify(ref.channel)} as its ${ref.field}, but the team's ACL ` +
          `does not grant ${ref.side} on it — a Starter resolves its channels under the TEAM's ` +
          `authority, so add it to Team channels`
        : `state ${JSON.stringify(ref.state)} uses channel ${JSON.stringify(ref.channel)} as its ${ref.field}, but this team declares ` +
          `no channel ACL at all — add it under Team channels, or the runtime refuses the save`,
    });
  }
  return out;
}

/** The ACL a definition WOULD need for everything it references — what the
 *  canvas offers to fill in. Sorted, so the same graph always yields the same
 *  block. */
export function requiredACL(model: CanvasModel): { publish: string[]; subscribe: string[] } {
  const pub = new Set<string>();
  const sub = new Set<string>();
  for (const r of channelRefs(model)) (r.side === "publish" ? pub : sub).add(r.channel);
  return { publish: [...pub].sort(), subscribe: [...sub].sort() };
}
