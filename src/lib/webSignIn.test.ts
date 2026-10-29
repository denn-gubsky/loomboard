import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInAddressMismatchError } from "./appSignIn";
import { finishWebSignIn, isWebCallback, startWebSignIn, webRedirectUri } from "./webSignIn";

const ISSUER = "https://lc.example";
// What the Base URL's metadata answers; a test swaps it for another server's.
let issuer = ISSUER;
const metadata = () =>
  Response.json({
    issuer,
    authorization_endpoint: `${issuer}/v1/_oauth/authorize`,
    token_endpoint: `${issuer}/v1/_oauth/token`,
    revocation_endpoint: `${issuer}/v1/_oauth/revoke`,
  });

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

const loc = (href: string) => {
  const u = new URL(href);
  return { protocol: u.protocol, hostname: u.hostname, origin: u.origin, port: u.port, pathname: u.pathname };
};

// The order things happened in: "replace" (address bar cleared) and each
// request's path.
let events: string[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  events = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    events.push(new URL(url, "http://page.invalid").pathname);
    if (url.endsWith("/.well-known/oauth-authorization-server")) return metadata();
    if (url.endsWith("/v1/_oauth/token")) {
      return Response.json({ access_token: "at-1", token_type: "Bearer", expires_in: 3600, refresh_token: "rt-1" });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webRedirectUri", () => {
  it("is the page's own origin plus the callback path", () => {
    expect(webRedirectUri(loc("https://board.example/chat"))).toEqual({ uri: "https://board.example/auth/callback" });
    expect(webRedirectUri(loc("http://127.0.0.1:5173/"))).toEqual({ uri: "http://127.0.0.1:5173/auth/callback" });
  });

  it("asks for 127.0.0.1 when the page is at http://localhost, which loomcycle never accepts", () => {
    const r = webRedirectUri(loc("http://localhost:4173/"));
    expect(r).toHaveProperty("problem");
    expect((r as { problem: string }).problem).toContain("http://127.0.0.1:4173/");
  });
});

describe("startWebSignIn", () => {
  it("keeps the verifier in the tab's storage and sends the page to the issuer's authorize URL", async () => {
    const storage = new MemoryStorage();
    const assign = vi.fn();
    await startWebSignIn(ISSUER, { storage, assign, loc: loc("https://board.example/") });
    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/v1/_oauth/authorize`);
    expect(url.searchParams.get("redirect_uri")).toBe("https://board.example/auth/callback");
    const pending = JSON.parse(storage.getItem("loomboard.signin.pending")!);
    expect(pending.state).toBe(url.searchParams.get("state"));
    expect(url.href).not.toContain(pending.verifier);
  });

  it("refuses a Base URL whose metadata names another server's sign-in, without redirecting", async () => {
    issuer = "https://victim.example";
    try {
      const storage = new MemoryStorage();
      const assign = vi.fn();
      await expect(
        startWebSignIn(ISSUER, { storage, assign, loc: loc("https://board.example/") }),
      ).rejects.toBeInstanceOf(SignInAddressMismatchError);
      expect(assign).not.toHaveBeenCalled();
      expect(storage.length).toBe(0);
    } finally {
      issuer = ISSUER;
    }
  });

  it("follows a different sign-in server only when the person set it", async () => {
    issuer = "https://public.example";
    try {
      const storage = new MemoryStorage();
      const assign = vi.fn();
      await startWebSignIn("http://192.168.0.77:8787", {
        storage,
        assign,
        loc: loc("https://board.example/"),
        override: "https://public.example",
      });
      expect(new URL(assign.mock.calls[0][0] as string).origin).toBe("https://public.example");
    } finally {
      issuer = ISSUER;
    }
  });

  it("starts nothing from a page at http://localhost", async () => {
    const storage = new MemoryStorage();
    const assign = vi.fn();
    await expect(startWebSignIn(ISSUER, { storage, assign, loc: loc("http://localhost:5173/") })).rejects.toThrow(/127\.0\.0\.1/);
    expect(assign).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("finishWebSignIn", () => {
  async function started() {
    const storage = new MemoryStorage();
    const assign = vi.fn();
    await startWebSignIn(ISSUER, { storage, assign, loc: loc("https://board.example/") });
    const state = new URL(assign.mock.calls[0][0] as string).searchParams.get("state")!;
    events.length = 0;
    return { storage, state };
  }
  const replaceState = (path: string) => events.push(`replace:${path}`);

  it("clears the code from the address bar before it is exchanged", async () => {
    const { storage, state } = await started();
    const href = `https://board.example/auth/callback?code=c1&state=${state}&iss=${encodeURIComponent(ISSUER)}`;
    const out = await finishWebSignIn({ storage, href, replaceState });
    expect(out).toMatchObject({ baseUrl: ISSUER, tokens: { access_token: "at-1", refresh_token: "rt-1" } });
    expect(events).toEqual(["replace:/", "/v1/_oauth/token"]);
  });

  it("clears the address bar even when the response is refused", async () => {
    const { storage } = await started();
    const href = `https://board.example/auth/callback?code=c1&state=forged&iss=${encodeURIComponent(ISSUER)}`;
    await expect(finishWebSignIn({ storage, href, replaceState })).rejects.toMatchObject({ code: "state_mismatch" });
    expect(events).toEqual(["replace:/"]);
  });

  it("refuses a redirect whose iss names another server, before spending the code", async () => {
    const { storage, state } = await started();
    const href = `https://board.example/auth/callback?code=c1&state=${state}&iss=https%3A%2F%2Fvictim.example`;
    await expect(finishWebSignIn({ storage, href, replaceState })).rejects.toMatchObject({ code: "issuer_mismatch" });
    expect(events).toEqual(["replace:/"]);
  });

  it("refuses a second completion, so reloading the callback does not replay it", async () => {
    const { storage, state } = await started();
    const href = `https://board.example/auth/callback?code=c1&state=${state}&iss=${encodeURIComponent(ISSUER)}`;
    await finishWebSignIn({ storage, href, replaceState });
    events.length = 0;
    await expect(finishWebSignIn({ storage, href, replaceState })).rejects.toThrow(/No sign-in was started/);
    expect(events).toEqual(["replace:/"]);
  });
});

describe("isWebCallback", () => {
  it("matches only the callback path", () => {
    expect(isWebCallback({ pathname: "/auth/callback" })).toBe(true);
    expect(isWebCallback({ pathname: "/" })).toBe(false);
  });
});
