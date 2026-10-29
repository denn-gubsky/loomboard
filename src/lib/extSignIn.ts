import type { OAuthTokenSet } from "@loomcycle/client";
import { SignInCancelledError, beginSignIn, completeSignIn, oauthFor } from "./appSignIn";

// The Chrome extension's sign-in: chrome.identity.launchWebAuthFlow shows
// loomcycle's authorize page in a browser window of its own and hands back the
// URL the flow ends on, which must be under the extension's own
// https://<extension-id>.chromiumapp.org/. That address depends on the
// extension's ID — a store install and an unpacked one differ — so the
// operator registers it per install; the side panel shows it.
//
// The panel reaches loomcycle with a plain fetch under its host permission, so
// the token calls go straight to the Base URL.

/** The two chrome.identity calls the flow needs (a fake in tests). */
export interface ChromeIdentity {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
}

/** The redirect URI to register for this install. */
export function extRedirectUri(identity: Pick<ChromeIdentity, "getRedirectURL">): string {
  return identity.getRedirectURL();
}

/** Run an extension sign-in to the end. Rejects with SignInCancelledError when
 *  the person closed the window — which is also how a loomcycle error page
 *  (an unregistered redirect URI) ends, since it never redirects back. */
export async function extSignIn(
  baseUrl: string,
  identity: ChromeIdentity,
): Promise<OAuthTokenSet> {
  const t = { baseUrl };
  const { url, pending } = await beginSignIn(oauthFor(t), baseUrl, extRedirectUri(identity));
  let landed: string | undefined;
  try {
    landed = await identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    // Chrome reports a closed window as "The user did not approve access."
    if (e instanceof Error && /did not approve/i.test(e.message)) throw new SignInCancelledError();
    throw e;
  }
  if (!landed) throw new SignInCancelledError();
  return completeSignIn(t, pending, landed);
}
