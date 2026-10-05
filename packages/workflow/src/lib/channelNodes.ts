// Channel nodes: the channels a team names, drawn as nodes of their own that
// data edges route THROUGH (RFC CZ, "The node-graph target").
//
// WHY a node rather than an edge label: a channel is a carrier with state of
// its own — a scope, a hold, hooks that gate every message, a backlog — and
// several publishers and readers. Drawn as a label on N×M direct edges it has
// nowhere to show any of that, and a fan-in (three Starters publishing to one
// channel) reads as three unrelated edges. As a node it is one thing with a
// face, and `publisher → [channel] → reader` says exactly what happens.
//
// DERIVED, not stored: a channel node exists because a node's config names the
// channel (channelRefs), never because it is in the definition. The only thing
// persisted is where it is drawn — in `layout.nodes`, under a reserved key,
// which teamgraph decodes as an ordinary NodePos and excludes from the hash.
// It is referenced, never created (decision C11): a ChannelDef lives outside
// the TeamDef.
//
// Pure: no React, no network.

import type { ChannelInfo } from "../types";
import { localNames, localRef } from "./teamLocal";
import { channelAllowed, channelRefs, grantList, type ChannelSide } from "./channels";
import { CHANNEL_LAYOUT_PREFIX, storedDerivedPosition, type CanvasModel, type XY } from "./model";

/** Layout key and node id prefix. teamgraph's Layout.Nodes is a free
 *  map[string]NodePos, so this is a legal key that no validator reads. */
export const CHANNEL_NODE_PREFIX = CHANNEL_LAYOUT_PREFIX;

/** How far above the states it connects an unplaced channel sits. Data edges
 *  use the TOP handles (decision C9), so above is where they already point. */
export const CHANNEL_LIFT = 140;

/** The footprint an auto-placed channel keeps clear of another. A channel
 *  node renders about 220–230 × 100 px (measured in the browser), so anything
 *  closer than this overlaps — not only an exact collision. */
export const CHANNEL_CLEARANCE = { x: 250, y: 110 };

export interface ChannelNodeView {
  /** The node id and layout key — `channel:<name>`, made unique against state
   *  ids (a state may legally be named "channel:x"). */
  id: string;
  channel: string;
  /** States that publish to it (a Starter's sink, a `channel` node). */
  publishers: string[];
  /** States that read it (a Starter's source). */
  readers: string[];
  position: XY;
  /** True when the position came from the layout rather than auto-placement. */
  placed: boolean;
  /** True when some node names it. A PLACED channel nothing names yet is drawn
   *  so it can be wired, and is the only kind of channel node that can be
   *  removed — a wired one exists because of a node's config. */
  wired: boolean;
  /** Per side IN USE: whether the team's ACL grants it. A side nobody uses is
   *  absent — it needs no grant. */
  grants: Partial<Record<ChannelSide, boolean>>;
  /** The runtime's declaration, when the host listed channels. */
  info?: ChannelInfo;
  /** False when the list loaded and this channel is not in it — the runtime
   *  refuses an undeclared channel. Undefined when nothing was listed. */
  declared?: boolean;
}

function isXY(v: unknown): v is XY {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.x === "number" && typeof p.y === "number";
}

/** The stored position for a channel node id, if any. A channel the operator
 *  removed has none, even while the saved layout still lists it. */
function storedPosition(model: CanvasModel, id: string): XY | undefined {
  if (model.channelsRemoved?.includes(id)) return undefined;
  return storedDerivedPosition(model, id);
}

/** Layout keys that look like placed channels. */
function placedKeys(model: CanvasModel): string[] {
  const states = new Set(model.nodes.map((n) => n.id));
  const removed = new Set(model.channelsRemoved ?? []);
  const layout = model.source.layout;
  const saved =
    typeof layout === "object" && layout !== null && !Array.isArray(layout)
      ? (layout as Record<string, unknown>).nodes
      : undefined;
  const keys = new Set([
    ...Object.keys(typeof saved === "object" && saved !== null ? saved : {}),
    ...Object.keys(model.derivedPositions ?? {}),
  ]);
  return [...keys].filter((k) => k.startsWith(CHANNEL_NODE_PREFIX) && !states.has(k) && !removed.has(k));
}

/** The node id for a channel, unique against the model's state ids. */
export function channelNodeId(model: CanvasModel, channel: string): string {
  const states = new Set(model.nodes.map((n) => n.id));
  let id = CHANNEL_NODE_PREFIX + channel;
  // A state literally named "channel:<name>" keeps its id; the channel node
  // steps aside rather than the two sharing one xyflow id and one layout key.
  while (states.has(id)) id += "'";
  return id;
}

/** Every channel the model names, as a node. `infos` is the host's channel
 *  list: absent means "not listed", which is different from "not declared". */
export function channelNodes(model: CanvasModel, infos?: readonly ChannelInfo[]): ChannelNodeView[] {
  // An opaque node's fields mean whatever a newer runtime says they mean, so
  // its `channel` / `source` / `sink` are not drawn as wiring (decision 3).
  const opaque = new Set(model.nodes.filter((n) => n.opaque).map((n) => n.id));
  const byChannel = new Map<string, { publishers: Set<string>; readers: Set<string> }>();
  for (const r of channelRefs(model)) {
    if (opaque.has(r.state)) continue;
    const e = byChannel.get(r.channel) ?? { publishers: new Set(), readers: new Set() };
    (r.side === "publish" ? e.publishers : e.readers).add(r.state);
    byChannel.set(r.channel, e);
  }

  // Placed channels: a `channel:` layout key (saved, or placed this session)
  // that no state owns and nobody removed. Drawn even when nothing names the
  // channel yet — that is how a channel is placed first and wired after.
  for (const key of placedKeys(model)) {
    const channel = key.slice(CHANNEL_NODE_PREFIX.length);
    if (channel && channelNodeId(model, channel) === key && !byChannel.has(channel)) {
      byChannel.set(channel, { publishers: new Set(), readers: new Set() });
    }
  }

  const pos = new Map(model.nodes.map((n) => [n.id, n.position]));
  const taken: XY[] = [];
  const overlaps = (p: XY) =>
    taken.some((t) => Math.abs(t.x - p.x) < CHANNEL_CLEARANCE.x && Math.abs(t.y - p.y) < CHANNEL_CLEARANCE.y);
  const out: ChannelNodeView[] = [];
  for (const channel of [...byChannel.keys()].sort()) {
    const { publishers, readers } = byChannel.get(channel)!;
    const id = channelNodeId(model, channel);
    const stored = storedPosition(model, id);
    let position = stored;
    if (!position) {
      // Above the middle of everything it connects.
      const pts = [...publishers, ...readers].map((s) => pos.get(s)).filter(isXY);
      const x = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length);
      const y = Math.min(...pts.map((p) => p.y)) - CHANNEL_LIFT;
      position = { x: Math.round(x), y: Math.round(Number.isFinite(y) ? y : -CHANNEL_LIFT) };
      // Two channels between the same states would land on (or near) one
      // spot; step right until this one is clear of every channel so far.
      while (overlaps(position)) position = { x: position.x + CHANNEL_CLEARANCE.x, y: position.y };
    }
    taken.push(position);

    const grants: Partial<Record<ChannelSide, boolean>> = {};
    // The team may always publish to and read its own channel: no ACL entry.
    const own = localRef(channel) !== undefined;
    if (publishers.size) grants.publish = own || channelAllowed(channel, grantList(model, "publish"));
    if (readers.size) grants.subscribe = own || channelAllowed(channel, grantList(model, "subscribe"));

    const info = infos?.find((c) => c.name === channel);
    out.push({
      id,
      channel,
      publishers: [...publishers].sort(),
      readers: [...readers].sort(),
      position,
      placed: !!stored,
      wired: publishers.size + readers.size > 0,
      grants,
      info,
      // The team's own channel is declared by the team itself (local.channels),
      // and never appears in the channel listing (RFC DV).
      declared: localRef(channel) !== undefined ? localNames(model, "channels").includes(localRef(channel)!) : infos ? !!info : undefined,
    });
  }
  return out;
}

/** One line for the channel's face: what is stored and what a reader can
 *  actually see. `message_count` includes held messages and those awaiting
 *  the channel's hooks, which no reader sees yet. */
export function channelBacklog(info?: ChannelInfo): string | undefined {
  if (!info) return undefined;
  const total = info.message_count ?? 0;
  const held = info.held_count ?? 0;
  const hooked = info.awaiting_hooks_count ?? 0;
  const visible = Math.max(0, total - held - hooked);
  const parts = [`${visible} readable`];
  if (held) parts.push(`${held} held`);
  if (hooked) parts.push(`${hooked} awaiting hooks`);
  return parts.join(" · ");
}
