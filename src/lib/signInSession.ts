import { OAuthError, type LoomcycleOAuth, type OAuthTokenSet, type TokenProvider } from "@loomcycle/client";
import { CLIENT_ID, type RefreshTokenStore, type StoredSignIn } from "./appSignIn";

// One signed-in loomcycle, as the app holds it: a TokenProvider the clients
// use, bound to the Base URL it was issued for.
//
// Why not the SDK's OAuthTokenProvider: a refresh token rotates on every use,
// and a spent one presented again ends the whole sign-in (RFC 9700 reuse
// detection). The SDK provider is single-flight within one provider, but
// loomboard can have several holders of one sign-in — extension panels in two
// windows share chrome.storage.session, a reload resumes a stored one — and
// each would refresh on its own. Here:
//
// - a resume uses the stored access token while it is valid, instead of
//   refreshing on every start;
// - every refresh runs under a lock named for the sign-in (Web Locks, which
//   extension pages and the service worker share), and first re-reads the
//   store: if another holder already rotated, its set is taken instead of
//   presenting a spent token.
//
// Web tabs do not share sessionStorage, so the lock cannot hand one tab
// another's rotation; there, claimSignIn keeps a sign-in to the one tab that
// holds it (see webSignIn).

/** Runs fn while holding an exclusive lock named `name`. */
export type RefreshLock = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** Web Locks where the platform has them (browsers, extension pages, recent
 *  webviews); otherwise just this context's own serialization. */
export function platformLock(): RefreshLock {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  // request() resolves with the callback's own result.
  if (locks) return <T,>(name: string, fn: () => Promise<T>) => locks.request(name, fn) as unknown as Promise<T>;
  return inProcessLock();
}

/** Serializes callers within this JavaScript context only. */
export function inProcessLock(): RefreshLock {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(name: string, fn: () => Promise<T>) => {
    const prev = tails.get(name) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    tails.set(name, run.catch(() => undefined));
    return run;
  };
}

/** A new sign-in's record, from the token set its code exchange returned. */
export function storedFrom(baseUrl: string, tokens: OAuthTokenSet, id: string): StoredSignIn {
  return {
    baseUrl,
    id,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: tokens.expires_at,
  };
}

/** A random sign-in id (names its lock; never a secret). */
export function newSignInId(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function signInOver(err: unknown): boolean {
  return err instanceof OAuthError && (err.code === "invalid_grant" || err.code === "invalid_client");
}

export interface SignInSessionOptions {
  /** The helper over the app's transport to the Base URL. */
  oauth: LoomcycleOAuth;
  stored: StoredSignIn;
  store: RefreshTokenStore;
  lock?: RefreshLock;
  /** Called once when the sign-in ends: the server refused the refresh token
   *  (revoked, expired, reused) or signOut() ran. */
  onSignedOut?: (reason: OAuthError) => void;
  /** Refresh this long before the access token expires (default 60 s). */
  refreshSkewMs?: number;
  now?: () => number;
}

export class SignInSession implements TokenProvider {
  readonly baseUrl: string;
  readonly id: string;
  private current: StoredSignIn | undefined;
  private inflight?: Promise<StoredSignIn>;
  private ended?: OAuthError;
  private readonly lock: RefreshLock;
  private readonly skew: number;
  private readonly now: () => number;

  constructor(private readonly opts: SignInSessionOptions) {
    this.baseUrl = opts.stored.baseUrl;
    this.id = opts.stored.id;
    this.current = opts.stored;
    this.lock = opts.lock ?? platformLock();
    this.skew = opts.refreshSkewMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** Whether the sign-in is still live. */
  get active(): boolean {
    return this.current !== undefined;
  }

  private fresh(s: StoredSignIn): boolean {
    return s.accessToken !== "" && this.now() < s.expiresAt - this.skew;
  }

  async getToken(): Promise<string | undefined> {
    const cur = this.current;
    if (!cur) throw this.ended ?? new OAuthError("signed_out");
    if (this.fresh(cur)) return cur.accessToken;
    try {
      return (await this.refreshOnce(undefined)).accessToken;
    } catch (err) {
      // A refresh ahead of expiry that failed for a transient reason leaves
      // a token that still works; past expiry there is none to send.
      if (this.current === cur && cur.accessToken && this.now() < cur.expiresAt && !signInOver(err)) {
        return cur.accessToken;
      }
      throw err;
    }
  }

  async onUnauthorized(rejected: string | undefined): Promise<string | undefined> {
    const cur = this.current;
    if (!cur) return undefined;
    if (rejected !== cur.accessToken) return cur.accessToken;
    try {
      return (await this.refreshOnce(rejected)).accessToken;
    } catch {
      return undefined;
    }
  }

  /** End the sign-in: revoke it on the server (RFC 7009 — the refresh token
   *  ends the whole sign-in) and clear the store. Resolves even offline; the
   *  tokens are forgotten either way. */
  async signOut(): Promise<void> {
    const cur = this.current;
    this.end(new OAuthError("signed_out"));
    await this.opts.store.clear().catch(() => undefined);
    if (!cur) return;
    try {
      await this.opts.oauth.revoke({ token: cur.refreshToken, clientId: CLIENT_ID });
    } catch {
      // Forgotten locally; the refresh token lapses on its own.
    }
  }

  private refreshOnce(rejected: string | undefined): Promise<StoredSignIn> {
    if (!this.inflight) {
      const p = this.lock(`loomboard.signin.refresh.${this.id}`, () => this.doRefresh(rejected));
      this.inflight = p;
      const clear = () => {
        if (this.inflight === p) this.inflight = undefined;
      };
      p.then(clear, clear);
    }
    return this.inflight;
  }

  private async doRefresh(rejected: string | undefined): Promise<StoredSignIn> {
    let cur = this.current;
    if (!cur) throw this.ended ?? new OAuthError("signed_out");
    // Another holder of this sign-in may have rotated it while we waited.
    const latest = await this.opts.store.load(this.baseUrl).catch(() => null);
    if (latest && latest.id === this.id && latest.refreshToken !== cur.refreshToken) {
      this.current = latest;
      cur = latest;
      if (this.fresh(latest) && latest.accessToken !== rejected) return latest;
    }
    let next: OAuthTokenSet;
    try {
      next = await this.opts.oauth.refresh({ refreshToken: cur.refreshToken, clientId: CLIENT_ID });
    } catch (err) {
      if (signInOver(err) && this.current === cur) {
        this.end(err as OAuthError);
        await this.opts.store.clear().catch(() => undefined);
      }
      throw err;
    }
    if (this.current !== cur) throw this.ended ?? new OAuthError("signed_out");
    const stored = storedFrom(this.baseUrl, next, this.id);
    // Stored before it is used: the refresh token it replaced is spent.
    await this.opts.store.save(stored);
    this.current = stored;
    return stored;
  }

  private end(reason: OAuthError): void {
    const was = this.current;
    this.current = undefined;
    this.ended = reason;
    if (was) this.opts.onSignedOut?.(reason);
  }
}

/** Web Locks as the claim needs them (a fake in tests). */
export interface ClaimLocks {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

/** Hold sign-in `id` for as long as this page lives. Resolves with a release
 *  function, or null when another page holds it — a duplicated browser tab
 *  copies sessionStorage, and the two would refresh the same token, which
 *  loomcycle takes as a replay and ends the sign-in. Without Web Locks the
 *  claim always succeeds. */
export async function claimSignIn(id: string, locks?: ClaimLocks): Promise<(() => void) | null> {
  const l = locks ?? ((globalThis.navigator as Navigator | undefined)?.locks as ClaimLocks | undefined);
  if (!l) return () => undefined;
  return new Promise((resolve) => {
    void l.request(`loomboard.signin.holder.${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return Promise.resolve();
      }
      return new Promise<void>((release) => resolve(() => release()));
    });
  });
}
