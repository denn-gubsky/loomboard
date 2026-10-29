import { describe, expect, it, vi } from "vitest";
import type { Invoke } from "../state/signInStore";
import { SignInCancelledError } from "./appSignIn";
import { tauriSignIn } from "./tauriSignIn";

const ISSUER = "https://lc.example";

function fakeServer() {
  const forms: URLSearchParams[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/.well-known/oauth-authorization-server")) return Response.json({ issuer: ISSUER });
    forms.push(new URLSearchParams(String(init?.body)));
    return Response.json({ access_token: "at-1", token_type: "Bearer", expires_in: 3600, refresh_token: "rt-1" });
  });
  return { forms, t: { baseUrl: ISSUER, fetch: fetchImpl as unknown as typeof fetch } };
}

// The Rust side as the webview sees it: a port, a browser that is "opened",
// and a wait that returns what the browser was redirected to.
function fakeNative(redirect: (authorizeUrl: URL) => string | null) {
  let opened: URL | null = null;
  const calls: string[] = [];
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push(cmd);
    if (cmd === "oauth_loopback_start") return 53817;
    if (cmd === "oauth_open_browser") opened = new URL(args?.url as string);
    if (cmd === "oauth_loopback_wait") return redirect(opened!);
    return undefined;
  }) as unknown as Invoke;
  return { invoke, calls, opened: () => opened };
}

describe("tauriSignIn", () => {
  it("signs in through the system browser and a loopback redirect on the listener's port", async () => {
    const srv = fakeServer();
    const native = fakeNative(
      (u) => `/auth/callback?code=c1&state=${u.searchParams.get("state")}&iss=${encodeURIComponent(ISSUER)}`,
    );
    const tokens = await tauriSignIn(srv.t, ISSUER, native.invoke);
    expect(tokens.access_token).toBe("at-1");
    expect(native.calls).toEqual(["oauth_loopback_start", "oauth_open_browser", "oauth_loopback_wait"]);
    const opened = native.opened()!;
    expect(opened.origin + opened.pathname).toBe(`${ISSUER}/v1/_oauth/authorize`);
    expect(opened.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:53817/auth/callback");
    expect(srv.forms[0].get("redirect_uri")).toBe("http://127.0.0.1:53817/auth/callback");
    expect(srv.forms[0].get("code")).toBe("c1");
  });

  it("ends as cancelled when the listener gives up", async () => {
    const srv = fakeServer();
    const native = fakeNative(() => null);
    await expect(tauriSignIn(srv.t, ISSUER, native.invoke)).rejects.toBeInstanceOf(SignInCancelledError);
    expect(srv.forms).toHaveLength(0);
  });

  it("refuses a loopback callback that another process forged", async () => {
    const srv = fakeServer();
    const native = fakeNative(() => `/auth/callback?code=stolen&state=guess&iss=${encodeURIComponent(ISSUER)}`);
    await expect(tauriSignIn(srv.t, ISSUER, native.invoke)).rejects.toMatchObject({ code: "state_mismatch" });
    expect(srv.forms).toHaveLength(0);
  });
});
