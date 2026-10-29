import { describe, expect, it, vi } from "vitest";
import { LoomcycleClient, LoomcycleOAuth, OAuthError } from "@loomcycle/client";
import type { RefreshTokenStore, StoredSignIn } from "./appSignIn";
import { SignInSession, claimSignIn, inProcessLock, type ClaimLocks } from "./signInSession";

const BASE = "https://lc.example";
const HOUR = 3_600_000;

// A fake loomcycle token endpoint that rotates, refuses a spent refresh token
// (and then the whole sign-in, as loomcycle's reuse detection does), and
// records every request.
function fakeServer() {
  const calls: { path: string; form: Record<string, string>; auth: string | null }[] = [];
  const spent = new Set<string>();
  let revoked = false;
  let n = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const form = typeof init?.body === "string" ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    calls.push({ path, form, auth: new Headers(init?.headers).get("Authorization") });
    if (path === "/v1/_oauth/token") {
      // A real round trip: concurrent refreshes would overlap here.
      await new Promise((r) => setTimeout(r, 5));
      if (revoked || spent.has(form.refresh_token)) {
        revoked = true;
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      spent.add(form.refresh_token);
      n++;
      return Response.json({ access_token: `at-${n}`, token_type: "Bearer", expires_in: 3600, refresh_token: `rt-${n}` });
    }
    if (path === "/v1/_oauth/revoke") {
      revoked = true;
      return new Response(null, { status: 200 });
    }
    if (path === "/v1/_me") return Response.json({ subject: "ada" });
    return new Response(null, { status: 404 });
  });
  return { calls, fetch: fetchImpl as unknown as typeof fetch, refreshes: () => calls.filter((c) => c.path === "/v1/_oauth/token") };
}

// One store shared by every holder — chrome.storage.session across panels.
function sharedStore(initial: StoredSignIn | null): RefreshTokenStore & { value: () => StoredSignIn | null } {
  let v = initial;
  return {
    value: () => v,
    load: async (baseUrl) => (v && v.baseUrl === baseUrl ? v : null),
    save: async (s) => {
      v = s;
    },
    clear: async () => {
      v = null;
    },
  };
}

const stored = (over: Partial<StoredSignIn> = {}): StoredSignIn => ({
  baseUrl: BASE,
  id: "s1",
  refreshToken: "rt-0",
  accessToken: "at-0",
  expiresAt: Date.now() + HOUR,
  ...over,
});

function session(srv: ReturnType<typeof fakeServer>, store: RefreshTokenStore, s: StoredSignIn, extra = {}) {
  return new SignInSession({ oauth: new LoomcycleOAuth({ baseUrl: BASE, fetch: srv.fetch }), stored: s, store, ...extra });
}

describe("SignInSession", () => {
  it("resumes inside the access token's lifetime without refreshing", async () => {
    const srv = fakeServer();
    const s = session(srv, sharedStore(null), stored());
    expect(await s.getToken()).toBe("at-0");
    expect(srv.calls).toEqual([]);
  });

  it("refreshes an expired token and stores the rotated set, its id kept, before using it", async () => {
    const srv = fakeServer();
    const store = sharedStore(null);
    const s = session(srv, store, stored({ accessToken: "", expiresAt: 0 }));
    expect(await s.getToken()).toBe("at-1");
    expect(srv.refreshes()[0].form).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-0", client_id: "loomboard" });
    expect(store.value()).toMatchObject({ id: "s1", refreshToken: "rt-1", accessToken: "at-1" });
  });

  it("refreshes once for two holders of one sign-in, which both carry on with the rotated set", async () => {
    // Two extension panels resuming the same stored sign-in at once: with a
    // refresh each, the second presents a spent token and loomcycle ends the
    // sign-in for both.
    const srv = fakeServer();
    const s0 = stored({ accessToken: "", expiresAt: 0 });
    const store = sharedStore(s0);
    const lock = inProcessLock();
    const a = session(srv, store, s0, { lock });
    const b = session(srv, store, s0, { lock });
    const [ta, tb] = await Promise.all([a.getToken(), b.getToken()]);
    expect(srv.refreshes()).toHaveLength(1);
    expect(ta).toBe("at-1");
    expect(tb).toBe("at-1");
    expect(a.active && b.active).toBe(true);
  });

  it("takes another holder's rotation after a 401 instead of presenting the spent token", async () => {
    const srv = fakeServer();
    const store = sharedStore(stored());
    const lock = inProcessLock();
    const a = session(srv, store, stored(), { lock });
    const b = session(srv, store, stored(), { lock });
    await a.onUnauthorized("at-0"); // a rotates rt-0 -> rt-1
    expect(await b.onUnauthorized("at-0")).toBe("at-1"); // b picks it up
    expect(srv.refreshes()).toHaveLength(1);
  });

  it("ends the sign-in and clears the store when the server refuses the refresh", async () => {
    const srv = fakeServer();
    const spentSet = stored({ refreshToken: "rt-spent", accessToken: "", expiresAt: 0 });
    const store = sharedStore(spentSet);
    const onSignedOut = vi.fn();
    const s = session(srv, store, spentSet, { onSignedOut });
    // Spend it first, as a replay would.
    await new LoomcycleOAuth({ baseUrl: BASE, fetch: srv.fetch }).refresh({ refreshToken: "rt-spent", clientId: "loomboard" });
    await expect(s.getToken()).rejects.toMatchObject({ code: "invalid_grant" });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(store.value()).toBeNull();
    expect(s.active).toBe(false);
  });

  it("signs out by revoking the refresh token (RFC 7009), clearing the store and forgetting the tokens", async () => {
    const srv = fakeServer();
    const store = sharedStore(stored());
    const onSignedOut = vi.fn();
    const s = session(srv, store, stored(), { onSignedOut });
    await s.signOut();
    expect(srv.calls.find((c) => c.path === "/v1/_oauth/revoke")?.form).toEqual({ token: "rt-0", client_id: "loomboard" });
    expect(store.value()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    await expect(s.getToken()).rejects.toBeInstanceOf(OAuthError);
  });

  it("signs a client's requests as its token provider", async () => {
    const srv = fakeServer();
    const s = session(srv, sharedStore(null), stored());
    await new LoomcycleClient({ baseUrl: BASE, tokenProvider: s, fetch: srv.fetch }).whoami();
    expect(srv.calls.find((c) => c.path === "/v1/_me")?.auth).toBe("Bearer at-0");
  });
});

// Web Locks' ifAvailable semantics, in memory.
function fakeLocks(): ClaimLocks {
  const held = new Set<string>();
  return {
    request: async (name, _opts, cb) => {
      if (held.has(name)) return cb(null);
      held.add(name);
      try {
        return await cb({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

describe("claimSignIn", () => {
  it("lets one page hold a sign-in, refuses a copy, and frees it on release", async () => {
    const locks = fakeLocks();
    const release = await claimSignIn("s1", locks);
    expect(release).not.toBeNull();
    expect(await claimSignIn("s1", locks)).toBeNull();
    expect(await claimSignIn("s2", locks)).not.toBeNull();
    release!();
    await new Promise((r) => setTimeout(r, 0));
    expect(await claimSignIn("s1", locks)).not.toBeNull();
  });
});
