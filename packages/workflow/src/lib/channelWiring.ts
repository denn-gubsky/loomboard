// Wiring a channel by drag (RFC CZ M5c): what a connection between a state and
// a channel NODE means, as an edit to the state's handler.
//
// There is no "channel edge" in the definition. A data edge is DERIVED from a
// node naming a channel (lib/channelNodes.ts), so drawing one is really
// setting that name — and only three settings are expressible:
//
//   [agent]  ── out ──▶ [channel]          sets its Starter's `sink.channel`
//   publish  ── data-out ──▶ [channel]     sets the channel node's `channel`
//   [channel] ── out ──▶ data-in ── Starter   sets the Starter's `source.channel`
//
// The sink is wired from the AGENT node because that is where a Starter's
// results leave on the graph (C2 amended); the Starter's own data-out is the
// dispatch to its agent, which is derived and not a wire.
//
// Everything else is refused, not approximated: an agent state reads and
// publishes no channel (the Starter is the team's single ACL subject), a
// channel does not feed a channel, and a control edge never touches one.
//
// A Starter reads exactly ONE channel and publishes to one sink, so a new wire
// REPLACES the old one rather than adding a second. That is the runtime's
// shape, not a canvas limit.
//
// Pure: no React, no network.

import { agentOwner, type AgentNodeView } from "./agentNodes";
import { AGENT_HANDLE, HANDLE } from "./flow";
import {
  CHANNEL_CLEARANCE,
  CHANNEL_LIFT,
  channelNodeId as channelNodeIdFor,
  type ChannelNodeView,
} from "./channelNodes";
import { handlerOf, patchHandler, type CanvasModel, type JsonObject } from "./model";

export interface WireAttempt {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface Wiring {
  state: string;
  field: "source" | "sink" | "channel";
  channel: string;
}

function isObj(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when either end is a channel node — such a connection is never a
 *  transition, whether or not it is a wiring the canvas accepts. */
export function touchesChannel(c: WireAttempt, views: readonly ChannelNodeView[]): boolean {
  return views.some((v) => v.id === c.source || v.id === c.target);
}

/** What this connection would set, or null when it is not a wiring the
 *  runtime can express. */
export function planWire(
  model: CanvasModel,
  views: readonly ChannelNodeView[],
  c: WireAttempt,
  agents: readonly AgentNodeView[] = [],
): Wiring | null {
  const from = views.find((v) => v.id === c.source);
  const to = views.find((v) => v.id === c.target);
  // Two states is a transition, not a wire. (Channel → channel needs no
  // guard of its own: a channel node is not a state, so the state lookups
  // below refuse it.)
  if (!from && !to) return null;

  if (to) {
    // agent → channel: its Starter's sink. Only from the agent's out handle.
    const owner = c.source ? agentOwner(agents, c.source) : undefined;
    if (owner) {
      return c.sourceHandle === AGENT_HANDLE.out ? { state: owner, field: "sink", channel: to.channel } : null;
    }
    // publish node → channel. A Starter's own data-out is its dispatch.
    const n = model.nodes.find((x) => x.id === c.source);
    if (!n || n.opaque || c.sourceHandle !== HANDLE.dataOut) return null;
    if (n.kind === "channel") return { state: n.id, field: "channel", channel: to.channel };
    return null;
  }

  // channel → state: a read. Only a Starter reads, and only on its data-in.
  const n = model.nodes.find((x) => x.id === c.target);
  if (!n || n.opaque || c.targetHandle !== HANDLE.dataIn) return null;
  if (n.kind === "starter") return { state: n.id, field: "source", channel: from!.channel };
  return null;
}

/** Apply a wiring to the model. The rest of the Starter's `source` / `sink`
 *  block — wait, batch, n — is kept: only the channel changes. */
export function applyWire(model: CanvasModel, w: Wiring): CanvasModel {
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      if (n.id !== w.state) return n;
      if (w.field === "channel") return patchHandler(n, { channel: w.channel });
      const block = handlerOf(n)[w.field];
      return patchHandler(n, { [w.field]: { ...(isObj(block) ? block : {}), channel: w.channel } });
    }),
  };
}

export type ConnectionKind = "wire" | "transition" | "invalid";

/** How the canvas treats a drag. A control transition runs between the
 *  control handles only — a drag that starts or ends on a DATA handle is never
 *  a transition, or dragging from a Starter's dispatch handle to an agent
 *  state would silently add a `success` edge. A Starter's transitions are
 *  dragged from its AGENT node's control handle (see transitionSource). */
export function connectionKind(
  model: CanvasModel,
  views: readonly ChannelNodeView[],
  c: WireAttempt,
  agents: readonly AgentNodeView[] = [],
): ConnectionKind {
  if (touchesChannel(c, views)) return planWire(model, views, c, agents) ? "wire" : "invalid";
  // An agent node is not a state: nothing transitions INTO it, and the only
  // way out is its control handle, which is its Starter's transition.
  if (c.target && agentOwner(agents, c.target)) return "invalid";
  if (c.source && agentOwner(agents, c.source)) {
    return c.sourceHandle === AGENT_HANDLE.control ? "transition" : "invalid";
  }
  if (c.sourceHandle === HANDLE.dataOut || c.targetHandle === HANDLE.dataIn) return "invalid";
  return "transition";
}

/** The state a new transition leaves from: a drag from an agent node's
 *  control handle is its Starter's. */
export function transitionSource(agents: readonly AgentNodeView[], id: string): string {
  return agentOwner(agents, id) ?? id;
}

/** Place a reference to an existing channel (decision C11: referenced, never
 *  created — the ChannelDef lives outside the TeamDef). All that is written is
 *  a layout position, so placing changes no content; wiring it does. A
 *  channel already on the canvas is not placed twice. */
export function placeChannel(
  model: CanvasModel,
  views: readonly ChannelNodeView[],
  channel: string,
): CanvasModel {
  const name = channel.trim();
  if (!name || views.some((v) => v.channel === name)) return model;
  const id = channelNodeIdFor(model, name);
  // Above everything, clear of every channel already drawn.
  const ys = [...model.nodes.map((n) => n.position.y), ...views.map((v) => v.position.y)];
  const y = (ys.length ? Math.min(...ys) : 0) - CHANNEL_LIFT;
  let x = 0;
  while (views.some((v) => Math.abs(v.position.x - x) < CHANNEL_CLEARANCE.x && Math.abs(v.position.y - y) < CHANNEL_CLEARANCE.y)) {
    x += CHANNEL_CLEARANCE.x;
  }
  return {
    ...model,
    layoutDirty: true,
    derivedPositions: { ...(model.derivedPositions ?? {}), [id]: { x, y: Math.round(y) } },
    channelsRemoved: model.channelsRemoved?.filter((k) => k !== id),
  };
}

/** Remove a placed channel nothing is wired to. A wired one is left alone:
 *  it exists because a node names it. */
export function removeChannel(model: CanvasModel, view: ChannelNodeView): CanvasModel {
  if (view.wired) return model;
  const positions = { ...(model.derivedPositions ?? {}) };
  delete positions[view.id];
  return {
    ...model,
    layoutDirty: true,
    derivedPositions: positions,
    channelsRemoved: [...new Set([...(model.channelsRemoved ?? []), view.id])],
  };
}
