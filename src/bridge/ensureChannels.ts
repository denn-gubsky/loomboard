import type { LoomcycleClient } from "@loomcycle/client";
import { CMD_CHANNEL, RESULT_CHANNEL } from "./protocol";

export interface ChannelPreflight {
  ok: boolean;
  missing: string[];
}

// Preflight the browser-bridge channels. The in-band Channel tool refuses
// undeclared channel names, so `browser.cmd` / `browser.result` must be declared
// on the runtime (operator yaml, scope: user) before actuation can work. We
// surface which are missing so the panel can show a clear operator-setup message;
// the chat itself still works without them.
export async function preflightChannels(
  client: LoomcycleClient,
): Promise<ChannelPreflight> {
  const { channels } = await client.listChannels();
  const names = new Set(channels.map((c) => c.name));
  const missing = [CMD_CHANNEL, RESULT_CHANNEL].filter((n) => !names.has(n));
  return { ok: missing.length === 0, missing };
}
