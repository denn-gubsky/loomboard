import {
  LoomcycleError,
  LoomcycleOAuth,
  OAuthError,
  parseAuthorizeResponse,
  type OAuthTokenSet,
} from "@loomcycle/client";
import { describeError } from "../chat/lib/errors";
import type { Transport } from "./buildConnection";

// "Sign in with loomcycle" (RFC FL): loomboard is a registered app of the
// loomcycle it talks to. It sends the person to loomcycle's own sign-in page —
// which offers whatever gates the operator configured — and gets back a code it
// trades, with a PKCE verifier only it holds, for a short-lived access token and
// a rotating refresh token. loomboard never sees a password or the gate config,
// and authorizes nothing itself: every call carries the user's token.
//
// This module is the part every form factor shares (web, extension, desktop);
// each one only differs in how the person gets to the authorize URL and back,
// and where the refresh token is kept between starts.

/** The client id loomboard is registered under (loomcycle's `loomboard`
 *  preset, or the operator's `auth.clients.loomboard`). */
export const CLIENT_ID = "loomboard";

/** Where a web or desktop sign-in returns to. */
export const CALLBACK_PATH = "/auth/callback";

/** A sign-in in progress. The verifier is a secret until the exchange: it may
 *  sit in tab-scoped storage for the round trip, never in a URL or a log. */
export interface PendingSignIn {
  baseUrl: string;
  issuer: string;
  redirectUri: string;
  state: string;
  verifier: string;
}

/** What survives between app starts, tagged with the server it belongs to so
 *  a changed Base URL never replays it elsewhere. The access token and its
 *  expiry are kept beside the refresh token so a start inside the token's
 *  hour reuses it instead of refreshing (each refresh rotates the refresh
 *  token, and two holders refreshing at once end the sign-in). */
export interface StoredSignIn {
  baseUrl: string;
  /** Names the sign-in's locks (signInSession); not a secret. */
  id: string;
  refreshToken: string;
  accessToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** Where a form factor keeps a sign-in (sessionStorage, the extension's
 *  session storage, the OS keychain). */
export interface RefreshTokenStore {
  /** The sign-in stored for baseUrl; null for none or another server's. */
  load(baseUrl: string): Promise<StoredSignIn | null>;
  save(s: StoredSignIn): Promise<void>;
  clear(): Promise<void>;
}

/** A sign-in the person abandoned (closed the window, never came back). */
export class SignInCancelledError extends Error {
  constructor() {
    super("sign-in cancelled");
    this.name = "SignInCancelledError";
  }
}

/** A stored sign-in another tab already holds (a duplicated tab carries a
 *  copy of it). This tab signs in on its own instead. */
export class SignInInUseError extends Error {
  constructor() {
    super("sign-in held by another tab");
    this.name = "SignInInUseError";
  }
}

/** The sign-in helper for the metadata, token, refresh and revoke calls, over
 *  the app's own transport (dev proxy, native HTTP, or direct). */
export function oauthFor(t: Transport, issuer?: string): LoomcycleOAuth {
  return new LoomcycleOAuth({ baseUrl: t.baseUrl, fetch: t.fetch, issuer });
}

/** The issuer as an address a browser may be sent to. It comes from the
 *  server's metadata and is handed to location.assign / a browser window, so a
 *  `javascript:` (or any non-web) value would run in the app instead. */
function checkIssuer(issuer: string): string {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    throw new OAuthError("invalid_response", { errorDescription: "the server's issuer is not a URL" });
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new OAuthError("invalid_response", { errorDescription: "the server's issuer is not an http(s) address" });
  }
  return issuer;
}

/** The loomcycle a blank Base URL means (the same default as transportFor). */
export const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

/** The address a sign-in is bound to: the Base URL, blank = the local
 *  default. Shown on the sign-in button, so the person sees where they are
 *  about to be sent. */
export function signInAddress(baseUrl: string): string {
  return baseUrl.trim() || DEFAULT_BASE_URL;
}

/** scheme://host[:port] of an http(s) URL; null for anything else. Trailing
 *  slashes and paths do not matter, a default port is folded away. */
export function webOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** The server's metadata named an issuer on another origin than the Base
 *  URL's. Raised before anything is sent to that issuer. */
export class SignInAddressMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly found: string,
  ) {
    super(`sign-in address mismatch: expected ${expected}, the server names ${found}`);
    this.name = "SignInAddressMismatchError";
  }
}

/** Start a sign-in. The metadata comes from the Base URL, and its issuer must
 *  be on the Base URL's own origin. The code exchange, refresh and revoke
 *  always go to the Base URL (the SDK posts to baseUrl + /v1/_oauth/token and
 *  never reads the metadata's endpoints), so if the person were sent to an
 *  issuer elsewhere, the Base URL would receive that server's code and
 *  verifier and could redeem them itself (an OAuth mix-up). There is no
 *  override: to sign in to the issuer, enter it as the Base URL. A 404 means
 *  the server has no LOOMCYCLE_PUBLIC_URL and offers no app sign-in. */
export async function beginSignIn(
  oauth: LoomcycleOAuth,
  baseUrl: string,
  redirectUri: string,
): Promise<{ url: string; pending: PendingSignIn }> {
  const md = await oauth.discover();
  const issuer = checkIssuer(md.issuer);
  const issuerOrigin = webOrigin(issuer);
  const expected = signInAddress(baseUrl);
  const expectedOrigin = webOrigin(expected);
  if (!expectedOrigin || issuerOrigin !== expectedOrigin) {
    throw new SignInAddressMismatchError(expectedOrigin ?? expected, issuerOrigin ?? issuer);
  }
  const req = await new LoomcycleOAuth({ baseUrl: issuer }).beginAuthorize({
    clientId: CLIENT_ID,
    redirectUri,
  });
  return {
    url: req.url,
    pending: { baseUrl, issuer, redirectUri, state: req.state, verifier: req.verifier },
  };
}

/** Finish a sign-in from the URL the redirect landed on. The SDK checks the
 *  state, then the issuer, then an error, and only then spends the code. The
 *  server advertised RFC 9207 `iss` in the metadata beginSignIn read, so a
 *  response without one is refused rather than trusted (a mix-up attack
 *  strips it). */
export function completeSignIn(
  t: Transport,
  pending: PendingSignIn,
  redirectedTo: string,
): Promise<OAuthTokenSet> {
  const params = parseAuthorizeResponse(redirectedTo);
  if (params.iss === undefined) {
    return Promise.reject(
      new OAuthError("issuer_mismatch", { errorDescription: "the redirect does not name its server" }),
    );
  }
  return oauthFor(t, pending.issuer).completeAuthorize({
    ...params,
    expectedState: pending.state,
    verifier: pending.verifier,
    clientId: CLIENT_ID,
    redirectUri: pending.redirectUri,
  });
}

export type SignInProblemKind =
  | "pending"
  | "security"
  | "unsupported"
  | "mismatch"
  | "unregistered"
  | "cancelled"
  | "failed";

/** A sign-in failure as the person should read it. `unsupported` is the cue
 *  to open Advanced (the token path). Never carries a token: the texts are ours,
 *  plus the server's own error_description where it explains a refusal. */
export interface SignInProblem {
  kind: SignInProblemKind;
  message: string;
}

export function describeSignInError(e: unknown): SignInProblem {
  if (e instanceof SignInCancelledError) {
    return { kind: "cancelled", message: "Sign-in was cancelled before it finished." };
  }
  if (e instanceof SignInInUseError) {
    return {
      kind: "failed",
      message: "This tab is a copy of another signed-in loomboard tab. Sign in again to use loomboard here too.",
    };
  }
  if (e instanceof SignInAddressMismatchError) {
    return {
      kind: "mismatch",
      message:
        `This address's sign-in belongs to another server: ${e.expected} names ${e.found}. ` +
        "Nothing was sent there. Enter that server's address as the Base URL instead.",
    };
  }
  if (e instanceof OAuthError) {
    switch (e.code) {
      case "access_denied":
        if (e.errorDescription === "pending") {
          return {
            kind: "pending",
            message:
              "Your account is awaiting approval. You can sign in once an administrator of this loomcycle has approved it.",
          };
        }
        return {
          kind: "failed",
          message: "loomcycle did not let this account sign in to loomboard. Ask its operator to check your account.",
        };
      case "state_mismatch":
      case "issuer_mismatch":
        return {
          kind: "security",
          message:
            "The sign-in was refused for your safety: the response loomboard received does not belong to the sign-in it started. Start again — if this keeps happening, something may be interfering with the sign-in.",
        };
      case "oauth_issuer_unset":
        return unsupported();
      case "invalid_client":
        return {
          kind: "unregistered",
          message:
            "loomcycle does not accept loomboard from here: the app is not registered there, or not for this address." +
            (e.errorDescription ? ` (${e.errorDescription})` : "") +
            " Ask the operator to register it — see the addresses below.",
        };
      case "invalid_grant":
        return { kind: "failed", message: "The sign-in expired or was already used. Sign in again." };
      case "temporarily_unavailable":
        return { kind: "failed", message: "loomcycle is busy. Try again in a minute." };
    }
    // A server without the sign-in routes at all (an older loomcycle) answers
    // the metadata request 404 with no OAuth error code.
    if (e.status === 404) return unsupported();
    return { kind: "failed", message: `Sign-in failed (${e.code ?? "error"}).` };
  }
  if (e instanceof LoomcycleError && e.status === 404) return unsupported();
  return { kind: "failed", message: describeError(e) };
}

function unsupported(): SignInProblem {
  return {
    kind: "unsupported",
    message:
      "This loomcycle does not offer app sign-in: its operator has not set LOOMCYCLE_PUBLIC_URL. Ask them to, or connect with a token under Advanced.",
  };
}
