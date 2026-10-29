import { LoomcycleError, OAuthError, type LoomcycleOAuth } from "@loomcycle/client";
import { SignInKeptError, type RefreshTokenStore, type StoredSignIn } from "./appSignIn";
import { SignInSession } from "./signInSession";

// How the app and the extension's side panel make a sign-in their connection.
// Both hold sign-ins the same way, and the rules about when a sign-in ends are
// security-sensitive, so they live here once rather than in each root.

/** Shown when loomcycle ends a sign-in the app was using. */
export const SIGNED_OUT_MESSAGE =
  "Your loomcycle sign-in has ended — it was signed out, expired, or revoked. Sign in again.";

/** Whether a failure says nothing about the sign-in itself: the network, a
 *  restarting or overloaded server (5xx, 429), or the desktop's native
 *  transport, which rejects with a plain string. A 401 or 403, or an OAuth
 *  error such as invalid_grant, is an answer about this sign-in. */
export function transientFailure(err: unknown): boolean {
  if (err instanceof OAuthError && err.code === "temporarily_unavailable") return true;
  if (err instanceof LoomcycleError) {
    const s = err.status;
    return s === undefined || s === 429 || s >= 500;
  }
  if (err instanceof TypeError) return true; // fetch: the request never got an answer
  return typeof err === "string";
}

export interface AdoptSignInOptions<T> {
  stored: StoredSignIn;
  /** Straight from a code exchange, so not stored yet. */
  fresh: boolean;
  store: RefreshTokenStore;
  oauth: LoomcycleOAuth;
  /** loomcycle ended this sign-in after it was adopted. */
  onSignedOut: (session: SignInSession) => void;
  /** Make it the connection: whoami and the caller's own state. Throws if
   *  the sign-in cannot be used. */
  use: (session: SignInSession) => Promise<T>;
  /** Revoke and forget the sign-in everywhere. */
  end: () => Promise<void>;
  /** Stop using the session but keep the stored sign-in. The caller must keep
   *  `session` until a retry replaces it, and sign it out on a disconnect, a
   *  token connect or a new sign-in, so a kept refresh token is never cleared
   *  without being revoked. */
  drop: (session: SignInSession) => void;
}

/** Make a sign-in the connection. On a transient failure the stored sign-in
 *  is kept and SignInKeptError thrown, so a retry resumes it instead of
 *  sending the person through sign-in again (in the extension, a revoke would
 *  also end every other panel's sign-in). On any other failure it is revoked
 *  and forgotten, so no refresh token is left that nothing will use. */
export async function adoptSignIn<T>(o: AdoptSignInOptions<T>): Promise<T> {
  if (o.fresh) await o.store.save(o.stored);
  const session: SignInSession = new SignInSession({
    oauth: o.oauth,
    stored: o.stored,
    store: o.store,
    onSignedOut: () => o.onSignedOut(session),
  });
  try {
    return await o.use(session);
  } catch (e) {
    if (session.active && transientFailure(e)) {
      o.drop(session);
      throw new SignInKeptError(e);
    }
    await o.end();
    throw e;
  }
}
