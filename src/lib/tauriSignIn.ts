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
import type { Transport } from "./buildConnection";

// The desktop app's sign-in (RFC 8252 §7.3): a one-shot listener on a random
// 127.0.0.1 port (src-tauri's oauth_loopback_* commands), the authorize page
// in the system browser — never an embedded webview, which would let the app
// see the person's password — and the code read off the redirect the browser
// sends to that listener. The listener answers only CALLBACK_PATH and gives up
// after a few minutes, or when the person cancels.

/** Run a desktop sign-in to the end. Resolves with the tokens; rejects with
 *  SignInCancelledError if the person cancelled or never came back. */
export async function tauriSignIn(
  t: Transport,
  baseUrl: string,
  invoke: Invoke,
  override?: string,
): Promise<OAuthTokenSet> {
  const port = await invoke<number>("oauth_loopback_start");
  const origin = `http://127.0.0.1:${port}`;
  let begun: Awaited<ReturnType<typeof beginSignIn>>;
  try {
    begun = await beginSignIn(oauthFor(t), baseUrl, `${origin}${CALLBACK_PATH}`, signInAddress(baseUrl, override));
  } catch (e) {
    // Nothing will be redirected to the listener: release it now.
    await invoke<void>("oauth_loopback_cancel").catch(() => undefined);
    throw e;
  }
  const { url, pending } = begun;
  await invoke<void>("oauth_open_browser", { url });
  const target = await invoke<string | null>("oauth_loopback_wait");
  if (!target) throw new SignInCancelledError();
  return completeSignIn(t, pending, `${origin}${target}`);
}

/** Stop a desktop sign-in that is waiting for the browser. */
export function cancelTauriSignIn(invoke: Invoke): Promise<void> {
  return invoke<void>("oauth_loopback_cancel");
}
