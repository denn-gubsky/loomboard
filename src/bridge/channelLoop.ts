import type { LoomcycleClient } from "@loomcycle/client";
import {
  CMD_CHANNEL,
  RESULT_CHANNEL,
  type BrowserCommand,
  type BrowserResult,
} from "./protocol";
import { dispatchToTab } from "./dispatch";

const WAIT_MS = 25_000; // < the server's 30s long-poll cap; empty batch = keep-alive
const MAX_MESSAGES = 5;
const RETRY_MS = 2_000;
const SEEN_CAP = 500;

export interface LoopHandle {
  stop: () => void;
}

// Start the browser bridge: long-poll browser.cmd (the agent's commands), execute
// each in the active tab, and publish the result to browser.result. Runs in the
// side-panel document (persistent while open, unlike the ephemeral service
// worker, so a 25s long-poll is never dropped mid-run). Returns a handle to stop
// it (aborts the poll + dispatch + result publish).
export function startChannelLoop(
  client: LoomcycleClient,
  userId: string,
): LoopHandle {
  const ac = new AbortController();
  // Ignore commands published before this session started (stale runs from a
  // prior panel); the auto-committing cursor advances as we consume.
  const startedAt = Date.now();
  const seen = new Set<string>();

  async function run(): Promise<void> {
    while (!ac.signal.aborted) {
      let batch;
      try {
        batch = await client.subscribeChannel(CMD_CHANNEL, {
          scope: "user",
          userId,
          waitMs: WAIT_MS,
          maxMessages: MAX_MESSAGES,
          signal: ac.signal,
        });
      } catch {
        if (ac.signal.aborted) return;
        await sleep(RETRY_MS, ac.signal); // transient — back off, retry
        continue;
      }
      for (const msg of batch.messages) {
        if (ac.signal.aborted) return;
        const cmd = msg.value as BrowserCommand | null;
        if (!cmd || typeof cmd.id !== "string" || typeof cmd.op !== "string") {
          continue;
        }
        if (new Date(msg.published_at).getTime() < startedAt) continue; // stale
        if (seen.has(cmd.id)) continue; // idempotent (belt-and-suspenders)
        if (seen.size > SEEN_CAP) seen.clear();
        seen.add(cmd.id);

        const result = await dispatchToTab(cmd);
        await publishResult(client, userId, result, ac.signal);
      }
    }
  }

  void run();
  return { stop: () => ac.abort() };
}

async function publishResult(
  client: LoomcycleClient,
  userId: string,
  payload: BrowserResult,
  signal: AbortSignal,
): Promise<void> {
  try {
    await client.publishChannel(RESULT_CHANNEL, {
      scope: "user",
      userId,
      payload,
      signal,
    });
  } catch {
    // Aborted or transient; the agent's await times out and it can retry.
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
