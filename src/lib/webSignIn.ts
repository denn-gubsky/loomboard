import type { OAuthTokenSet } from "@loomcycle/client";
import { savePendingSignIn, takePendingSignIn } from "../state/signInStore";
import { CALLBACK_PATH, beginSignIn, completeSignIn, oauthFor } from "./appSignIn";
import { transportFor } from "./buildConnection";

// The web SPA's sign-in: a full-page redirect to loomcycle's authorize page and
// back to CALLBACK_PATH on this origin. The verifier and state wait in this
// tab's sessionStorage for the round trip only (read once on return). The
// server that serves the SPA must answer CALLBACK_PATH with index.html (the
// Vite dev server and the loomboard CLI do; a static host needs its SPA
// fallback on).

type Loc = Pick<Location, "protocol" | "hostname" | "origin" | "port" | "pathname">;

/** This page's redirect URI, or why it cannot have one. loomcycle accepts
 *  plain http only to a loopback IP literal (RFC 8252 §8.3: a name such as
 *  localhost may resolve elsewhere), so a page at http://localhost must be
 *  reopened at 127.0.0.1 — on the same port, which the loopback registration
 *  matches whatever it is. */
export function webRedirectUri(loc: Loc): { uri: string } | { problem: string } {
  if (loc.protocol === "http:" && loc.hostname === "localhost") {
    const port = loc.port ? `:${loc.port}` : "";
    return {
      problem: `Sign-in over plain http needs a loopback address loomcycle accepts: open loomboard at http://127.0.0.1${port}/ instead of localhost.`,
    };
  }
  return { uri: `${loc.origin}${CALLBACK_PATH}` };
}

/** Whether this page load is the return from a sign-in. */
export function isWebCallback(loc: Pick<Location, "pathname">): boolean {
  return loc.pathname === CALLBACK_PATH;
}

/** Start a sign-in and send this page to loomcycle's authorize URL. */
export async function startWebSignIn(
  baseUrl: string,
  deps: { storage: Storage; assign: (url: string) => void; loc: Loc },
): Promise<void> {
  const r = webRedirectUri(deps.loc);
  if ("problem" in r) throw new Error(r.problem);
  const { url, pending } = await beginSignIn(oauthFor(transportFor(baseUrl)), baseUrl, r.uri);
  savePendingSignIn(deps.storage, pending);
  deps.assign(url);
}

/** Finish the sign-in this page was redirected back to. The code, state and
 *  issuer are cleared from the address bar and the history entry FIRST,
 *  whatever happens next, so they never linger in history, a bookmark or a
 *  screenshot. */
export async function finishWebSignIn(deps: {
  storage: Storage;
  href: string;
  replaceState: (path: string) => void;
}): Promise<{ baseUrl: string; tokens: OAuthTokenSet }> {
  deps.replaceState("/");
  const pending = takePendingSignIn(deps.storage);
  if (!pending) {
    throw new Error("No sign-in was started in this tab, or it already finished. Sign in again.");
  }
  const tokens = await completeSignIn(transportFor(pending.baseUrl), pending, deps.href);
  return { baseUrl: pending.baseUrl, tokens };
}
