import { LoomcycleClient } from "@loomcycle/client";
import type { ConnectionSettings } from "../state/settings";
import { transportFor } from "./buildConnection";

// The APP's client singleton, used to validate a connection (whoami) and by the
// sidebar (fork cleanup on delete). The embeddable <Chat> builds its own client
// from the Connection it's given (see chat/lib/createClient) — this one is not
// part of the published component.
let client: LoomcycleClient | null = null;
let signature = "";

export function getClient(s: ConnectionSettings): LoomcycleClient {
  // NUL-join so a token containing the baseUrl (or vice versa) can't collide.
  const sig = `${s.baseUrl} ${s.token}`;
  if (!client || sig !== signature) {
    // The transport every client of the app shares (see transportFor): the
    // dev/CLI proxy, Tauri's native HTTP, or the Base URL directly.
    const t = transportFor(s.baseUrl);
    client = new LoomcycleClient({
      baseUrl: t.baseUrl,
      authToken: s.token || undefined,
      // Always a plain function: the SDK calls its stored fetch as a method
      // (`ctx.fetchImpl(url)`), and the browser's native fetch rejects a
      // non-global receiver with "Illegal invocation".
      fetch: (input, init) => (t.fetch ? t.fetch(input, init) : fetch(input, init)),
    });
    signature = sig;
  }
  return client;
}

export function resetClient(): void {
  client = null;
  signature = "";
}
