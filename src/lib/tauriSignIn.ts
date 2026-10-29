import type { OAuthTokenSet } from "@loomcycle/client";
import type { Invoke } from "../state/signInStore";
import {
  CALLBACK_PATH,
  SignInCancelledError,
  beginSignIn,
  completeSignIn,
  oauthFor,
  signInAddress,
} from "./appSignIn";
import { LOCAL_BASE_URL, type Transport } from "./buildConnection";

// The desktop app's sign-in (RFC 8252 §7.3): a one-shot listener on a random
// 127.0.0.1 port (src-tauri's oauth_loopback_* commands), the authorize page
// in the system browser — never an embedded webview, which would let the app
// see the person's password — and the code read off the redirect the browser
// sends to that listener. The listener is bound to the Base URL (the browser
// may open only that loomcycle's authorize page), answers only CALLBACK_PATH
// with this sign-in's state, and gives up after a few minutes, or when the
// person cancels.

/** Run a desktop sign-in to the end. Resolves with the tokens; rejects with
 *  SignInCancelledError if the person cancelled or never came back. */
export async function tauriSignIn(
  t: Transport,
  baseUrl: string,
  invoke: Invoke,
): Promise<OAuthTokenSet> {
  // The desktop app reaches LOCAL_BASE_URL for a blank Base URL, so the
  // address is never null here.
  const address = signInAddress(baseUrl, LOCAL_BASE_URL) ?? LOCAL_BASE_URL;
  const port = await invoke<number>("oauth_loopback_start", { baseUrl: address });
  const origin = `http://127.0.0.1:${port}`;
  let begun: Awaited<ReturnType<typeof beginSignIn>>;
  try {
    begun = await beginSignIn(oauthFor(t), baseUrl, `${origin}${CALLBACK_PATH}`, LOCAL_BASE_URL);
  } catch (e) {
    // Nothing will be redirected to the listener: release it now.
    await invoke<void>("oauth_loopback_cancel").catch(() => undefined);
    throw e;
  }
  const { url, pending } = begun;
  try {
    await invoke<void>("oauth_open_browser", { url });
  } catch (e) {
    // Cancelled while the metadata was read: the listener is already gone.
    if (e === NOT_IN_PROGRESS) throw new SignInCancelledError();
    // Refused (e.g. a plain-http host name): nothing will be redirected.
    await invoke<void>("oauth_loopback_cancel").catch(() => undefined);
    throw e;
  }
  let target: string | null;
  try {
    target = await invoke<string | null>("oauth_loopback_wait", { expectedState: pending.state });
  } catch (e) {
    if (e === NOT_IN_PROGRESS) throw new SignInCancelledError();
    throw e;
  }
  if (!target) throw new SignInCancelledError();
  return completeSignIn(t, pending, `${origin}${target}`);
}

/** What the loopback commands answer once their sign-in was cancelled or
 *  replaced (src-tauri/src/sign_in.rs NOT_IN_PROGRESS). */
export const NOT_IN_PROGRESS = "no sign-in is in progress";

/** Stop a desktop sign-in that is waiting for the browser. */
export function cancelTauriSignIn(invoke: Invoke): Promise<void> {
  return invoke<void>("oauth_loopback_cancel");
}
