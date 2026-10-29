// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider, useConnection } from "./connection";
import { buildConnection } from "../lib/buildConnection";
import { savePendingSignIn } from "./signInStore";

// The connection provider's sign-in lifecycle against two fake loomcycles,
// A (signed in with loomcycle) and B (a pasted token). These are the review's
// L1/L2 regressions: a sign-in must never outlive the connection it belongs
// to, nor its tokens reach another server.

const A = "https://a.example";
const B = "https://b.example";
const SIGNIN_KEY = "loomboard.signin";

interface Seen {
  server: string;
  path: string;
  auth: string | null;
  form: Record<string, string>;
}

let seen: Seen[];
let failMeOn: string | null;
let failStatus: number;
let n: number;

function serverOf(input: RequestInfo | URL, init?: RequestInit): { server: string; path: string } {
  const url = new URL(String(input), "http://page.invalid");
  const target = new Headers(init?.headers).get("x-loomcycle-target");
  return { server: target ? new URL(target).origin : url.origin, path: url.pathname };
}

// This jsdom + Node pairing exposes sessionStorage but no localStorage.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

beforeEach(() => {
  seen = [];
  failMeOn = null;
  failStatus = 403;
  n = 0;
  vi.stubGlobal("localStorage", new MemoryStorage());
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { server, path } = serverOf(input, init);
      const body = typeof init?.body === "string" ? Object.fromEntries(new URLSearchParams(init.body)) : {};
      seen.push({ server, path, auth: new Headers(init?.headers).get("Authorization"), form: body });
      if (path === "/.well-known/oauth-authorization-server") return Response.json({ issuer: server });
      if (path === "/v1/_oauth/token") {
        n++;
        const tag = server === A ? "a" : "b";
        return Response.json({
          access_token: `at-${tag}-${n}`,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: `rt-${tag}-${n}`,
        });
      }
      if (path === "/v1/_oauth/revoke") return new Response(null, { status: 200 });
      if (path === "/v1/_me") {
        if (server === failMeOn) return Response.json({ error: "boom" }, { status: failStatus });
        return Response.json({ subject: "ada", tenant_id: "", scopes: [] });
      }
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Ctx = ReturnType<typeof useConnection>;

function renderProvider(): { ctx: () => Ctx } {
  let latest: Ctx | null = null;
  function Probe() {
    latest = useConnection();
    return null;
  }
  render(
    <ConnectionProvider>
      <Probe />
    </ConnectionProvider>,
  );
  return { ctx: () => latest! };
}

// Land on the callback of a sign-in to A that this tab started.
function returnFromSignInToA() {
  savePendingSignIn(sessionStorage, {
    baseUrl: A,
    issuer: A,
    redirectUri: `${window.location.origin}/auth/callback`,
    state: "s1",
    verifier: "v".repeat(43),
  });
  window.history.replaceState(null, "", `/auth/callback?code=c1&state=s1&iss=${encodeURIComponent(A)}`);
}

describe("ConnectionProvider", () => {
  it("ends a sign-in when a token connection replaces it, so A's token never reaches B", async () => {
    returnFromSignInToA();
    const { ctx } = renderProvider();
    await waitFor(() => expect(ctx().status).toBe("connected"));
    expect(ctx().signIn).not.toBeNull();

    await act(async () => {
      await ctx().connect({ baseUrl: B, token: "lc_b" });
    });

    expect(ctx().status).toBe("connected");
    expect(ctx().signIn).toBeNull();
    // Revoked on A, and nothing of it kept.
    expect(seen.some((s) => s.server === A && s.path === "/v1/_oauth/revoke" && s.form.token === "rt-a-1")).toBe(true);
    expect(sessionStorage.getItem(SIGNIN_KEY)).toBeNull();
    // B is reached with B's token and never with A's.
    const toB = seen.filter((s) => s.server === B);
    expect(toB.length).toBeGreaterThan(0);
    expect(toB.every((s) => s.auth === "Bearer lc_b")).toBe(true);
    // The connection the app's surfaces build carries B's token.
    expect(buildConnection(ctx().settings!, ctx().signIn).token).toBe("lc_b");
  });

  it("points a refused pasted token at sign-in, asking without the token", async () => {
    failMeOn = B;
    failStatus = 401;
    const { ctx } = renderProvider();
    await act(async () => {
      await ctx().connect({ baseUrl: B, token: "lc_personal" });
    });
    expect(ctx().status).toBe("error");
    expect(ctx().error).toMatch(/Sign in with loomcycle/);
    const asked = seen.filter((s) => s.server === B && s.path === "/.well-known/oauth-authorization-server");
    expect(asked).toHaveLength(1);
    expect(asked[0].auth).toBeNull();
  });

  it("revokes and forgets a sign-in whose first request is refused", async () => {
    failMeOn = A;
    returnFromSignInToA();
    const { ctx } = renderProvider();
    await waitFor(() => expect(ctx().status).toBe("error"));
    expect(seen.some((s) => s.server === A && s.path === "/v1/_oauth/revoke" && s.form.token === "rt-a-1")).toBe(true);
    expect(sessionStorage.getItem(SIGNIN_KEY)).toBeNull();
    expect(ctx().signIn).toBeNull();
  });

  it("keeps a resumed sign-in when loomcycle does not answer, and resumes it on retry", async () => {
    // A reload while loomcycle restarts: a revoke here would force a new
    // sign-in (and, in the extension, end every other panel's).
    failMeOn = A;
    failStatus = 503;
    const kept = { baseUrl: A, id: "x1", refreshToken: "rt-a-9", accessToken: "at-a-9", expiresAt: Date.now() + 3_600_000 };
    sessionStorage.setItem(SIGNIN_KEY, JSON.stringify(kept));
    localStorage.setItem("loomboard.connection", JSON.stringify({ baseUrl: A, token: "", auth: "oauth" }));
    const { ctx } = renderProvider();
    await waitFor(() => expect(ctx().status).toBe("error"));
    expect(ctx().problem).toBe("unreachable");
    expect(ctx().error).toMatch(/still signed in/);
    expect(seen.some((s) => s.path === "/v1/_oauth/revoke")).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(SIGNIN_KEY)!)).toMatchObject({ refreshToken: "rt-a-9" });

    failMeOn = null;
    act(() => ctx().retrySignIn());
    await waitFor(() => expect(ctx().status).toBe("connected"));
    expect(ctx().signIn).not.toBeNull();
    expect(seen.filter((s) => s.path === "/v1/_me").every((s) => s.auth === "Bearer at-a-9")).toBe(true);
  });

  it("revokes a kept sign-in when the person disconnects instead of retrying", async () => {
    failMeOn = A;
    failStatus = 503;
    sessionStorage.setItem(
      SIGNIN_KEY,
      JSON.stringify({ baseUrl: A, id: "x1", refreshToken: "rt-a-9", accessToken: "at-a-9", expiresAt: Date.now() + 3_600_000 }),
    );
    localStorage.setItem("loomboard.connection", JSON.stringify({ baseUrl: A, token: "", auth: "oauth" }));
    const { ctx } = renderProvider();
    await waitFor(() => expect(ctx().problem).toBe("unreachable"));
    act(() => ctx().disconnect());
    await waitFor(() =>
      expect(seen.some((s) => s.server === A && s.path === "/v1/_oauth/revoke" && s.form.token === "rt-a-9")).toBe(true),
    );
    expect(sessionStorage.getItem(SIGNIN_KEY)).toBeNull();
  });

  it("keeps a new sign-in when loomcycle cannot be reached right after it", async () => {
    returnFromSignInToA();
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (serverOf(input, init).path === "/v1/_me") throw new TypeError("Failed to fetch");
        return real(input, init);
      }),
    );
    const { ctx } = renderProvider();
    await waitFor(() => expect(ctx().status).toBe("error"));
    expect(ctx().problem).toBe("unreachable");
    expect(seen.some((s) => s.path === "/v1/_oauth/revoke")).toBe(false);
    expect(sessionStorage.getItem(SIGNIN_KEY)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("loomboard.connection")!)).toMatchObject({ baseUrl: A, auth: "oauth" });
  });

  it("clears a stored sign-in when the tab connects with a token", async () => {
    sessionStorage.setItem(
      SIGNIN_KEY,
      JSON.stringify({ baseUrl: A, id: "x1", refreshToken: "rt-old", accessToken: "", expiresAt: 0 }),
    );
    localStorage.setItem("loomboard.connection", JSON.stringify({ baseUrl: B, token: "lc_b" }));
    const { ctx } = renderProvider();
    await waitFor(() => expect(ctx().status).toBe("connected"));
    expect(sessionStorage.getItem(SIGNIN_KEY)).toBeNull();
  });

  it("will not resume a sign-in another tab holds, and drops this tab's copy", async () => {
    // A duplicated tab: same sessionStorage, while the original still holds it.
    const held = new Set(["loomboard.signin.holder.x1"]);
    vi.stubGlobal("navigator", {
      ...window.navigator,
      locks: {
        request: async (name: string, _o: unknown, cb: (l: unknown) => Promise<void>) =>
          cb(held.has(name) ? null : { name }),
      },
    });
    sessionStorage.setItem(
      SIGNIN_KEY,
      JSON.stringify({ baseUrl: A, id: "x1", refreshToken: "rt-a-9", accessToken: "at-a-9", expiresAt: Date.now() + 3_600_000 }),
    );
    localStorage.setItem("loomboard.connection", JSON.stringify({ baseUrl: A, token: "", auth: "oauth" }));
    const { ctx } = renderProvider();
    await waitFor(() => expect(ctx().status).toBe("error"));
    expect(ctx().error).toMatch(/copy of another signed-in loomboard tab/);
    expect(sessionStorage.getItem(SIGNIN_KEY)).toBeNull();
    // Nothing was sent: the other tab's sign-in is untouched.
    expect(seen.filter((x) => x.path.startsWith("/v1/"))).toEqual([]);
  });

  it("resumes a stored sign-in inside its access token's lifetime without refreshing", async () => {
    sessionStorage.setItem(
      SIGNIN_KEY,
      JSON.stringify({ baseUrl: A, id: "x1", refreshToken: "rt-a-9", accessToken: "at-a-9", expiresAt: Date.now() + 3_600_000 }),
    );
    localStorage.setItem("loomboard.connection", JSON.stringify({ baseUrl: A, token: "", auth: "oauth" }));
    const { ctx } = renderProvider();
    await waitFor(() => expect(ctx().status).toBe("connected"));
    expect(seen.some((s) => s.path === "/v1/_oauth/token")).toBe(false);
    expect(seen.find((s) => s.path === "/v1/_me")?.auth).toBe("Bearer at-a-9");
  });
});
