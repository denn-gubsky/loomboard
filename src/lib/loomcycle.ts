import { LoomcycleClient, type TokenProvider } from "@loomcycle/client";
import type { ConnectionSettings } from "../state/settings";
import { transportFor } from "./buildConnection";

// The APP's client singleton, used to validate a connection (whoami) and by the
// sidebar (fork cleanup on delete). The embeddable <Chat> builds its own client
// from the Connection it's given (see chat/lib/createClient) — this one is not
// part of the published component.
let client: LoomcycleClient | null = null;
let signature = "";
let clientSignIn: TokenProvider | null = null;

/** The app's client for these settings. `signIn` is the token provider of a
 *  "Sign in with loomcycle" connection, which then refreshes on its own. */
export function getClient(s: ConnectionSettings, signIn?: TokenProvider | null): LoomcycleClient {
  // NUL-join so a token containing the baseUrl (or vice versa) can't collide.
  const sig = `${s.baseUrl} ${s.token}`;
  if (!client || sig !== signature || (signIn ?? null) !== clientSignIn) {
    // The transport every client of the app shares (see transportFor): the
    // dev/CLI proxy, Tauri's native HTTP, or the Base URL directly.
    const t = transportFor(s.baseUrl);
    client = new LoomcycleClient({
      baseUrl: t.baseUrl,
      ...(signIn ? { tokenProvider: signIn } : { authToken: s.token || undefined }),
      // Always a plain function: the SDK calls its stored fetch as a method
      // (`ctx.fetchImpl(url)`), and the browser's native fetch rejects a
      // non-global receiver with "Illegal invocation".
      fetch: (input, init) => (t.fetch ? t.fetch(input, init) : fetch(input, init)),
    });
    signature = sig;
    clientSignIn = signIn ?? null;
  }
  return client;
}

export function resetClient(): void {
  client = null;
  signature = "";
  clientSignIn = null;
}
