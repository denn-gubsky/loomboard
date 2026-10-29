import { describe, expect, it, vi } from "vitest";
import type { Invoke } from "../state/signInStore";
import { SignInAddressMismatchError, SignInCancelledError } from "./appSignIn";
import { tauriSignIn } from "./tauriSignIn";

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

function fakeServer() {
  const forms: URLSearchParams[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/.well-known/oauth-authorization-server")) return metadata();
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

  it("binds the listener to the Base URL and hands it the state the callback must carry", async () => {
    const srv = fakeServer();
    const args: Record<string, unknown> = {};
    let state = "";
    const invoke = vi.fn(async (cmd: string, a?: Record<string, unknown>) => {
      args[cmd] = a;
      if (cmd === "oauth_loopback_start") return 53817;
      if (cmd === "oauth_open_browser") state = new URL(a?.url as string).searchParams.get("state")!;
      if (cmd === "oauth_loopback_wait") return `/auth/callback?code=c1&state=${state}&iss=${encodeURIComponent(ISSUER)}`;
      return undefined;
    }) as unknown as Invoke;
    await tauriSignIn(srv.t, ISSUER, invoke);
    expect(args.oauth_loopback_start).toEqual({ baseUrl: ISSUER });
    expect(args.oauth_loopback_wait).toEqual({ expectedState: state });
    expect(state).not.toBe("");
  });

  it("refuses another server's sign-in before opening the browser, and releases the listener", async () => {
    issuer = "https://victim.example";
    try {
      const srv = fakeServer();
      const native = fakeNative(() => null);
      await expect(tauriSignIn(srv.t, ISSUER, native.invoke)).rejects.toBeInstanceOf(SignInAddressMismatchError);
      expect(native.calls).toEqual(["oauth_loopback_start", "oauth_loopback_cancel"]);
    } finally {
      issuer = ISSUER;
    }
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
