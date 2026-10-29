import { describe, expect, it, vi } from "vitest";
import { OAuthError, pkceChallenge } from "@loomcycle/client";
import {
  CLIENT_ID,
  SignInAddressMismatchError,
  SignInCancelledError,
  beginSignIn,
  completeSignIn,
  describeSignInError,
  oauthFor,
} from "./appSignIn";

const ISSUER = "https://lc.example";
const REDIRECT = "http://127.0.0.1:5173/auth/callback";

/** The server's RFC 8414 metadata, as loomcycle publishes it. */
function metadata(issuer = ISSUER, over: Record<string, string> = {}): Response {
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/v1/_oauth/authorize`,
    token_endpoint: `${issuer}/v1/_oauth/token`,
    revocation_endpoint: `${issuer}/v1/_oauth/revoke`,
    ...over,
  });
}

interface Seen {
  url: string;
  method: string;
  form: URLSearchParams | null;
  auth: string | null;
}

// A fake loomcycle: metadata, token and revoke, recording every request.
function fakeServer(opts: {
  metadata?: Response;
  token?: (form: URLSearchParams) => Response;
} = {}) {
  const seen: Seen[] = [];
  let n = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const form = typeof init?.body === "string" ? new URLSearchParams(init.body) : null;
    seen.push({ url, method: init?.method ?? "GET", form, auth: new Headers(init?.headers).get("Authorization") });
    if (url.endsWith("/.well-known/oauth-authorization-server")) {
      return opts.metadata ?? metadata();
    }
    if (url.endsWith("/v1/_oauth/token")) {
      if (opts.token) return opts.token(form!);
      n++;
      return Response.json({
        access_token: `at-${n}`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: `rt-${n}`,
      });
    }
    if (url.endsWith("/v1/_oauth/revoke")) return new Response(null, { status: 200 });
    if (url.endsWith("/v1/_me")) return Response.json({ subject: "ada" });
    return new Response("not found", { status: 404 });
  });
  return { seen, fetch: fetchImpl as unknown as typeof fetch };
}

describe("beginSignIn", () => {
  it("proceeds when the server's issuer is on the Base URL's origin", async () => {
    const srv = fakeServer();
    // Trailing slashes do not matter; the origin does.
    const { url, pending } = await beginSignIn(
      oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }),
      `${ISSUER}/`,
      REDIRECT,
    );
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/v1/_oauth/authorize`);
    expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe(await pkceChallenge(pending.verifier));
    expect(u.searchParams.get("state")).toBe(pending.state);
    expect(pending).toMatchObject({ baseUrl: `${ISSUER}/`, issuer: ISSUER, redirectUri: REDIRECT });
    // The verifier is a secret until the exchange: never in the URL.
    expect(url).not.toContain(pending.verifier);
    expect(srv.seen.map((s) => s.url)).toEqual([`${ISSUER}/.well-known/oauth-authorization-server`]);
  });

  it("refuses a server whose metadata names another server's sign-in, with no workaround", async () => {
    // A hostile server (or proxy) at the Base URL naming a real loomcycle's
    // issuer, to catch the code that loomcycle would send back. The code
    // exchange always goes to the Base URL, so the only safe answer is to
    // sign in at that other server directly.
    const srv = fakeServer({ metadata: metadata("https://victim.example") });
    const err = await beginSignIn(oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }), ISSUER, REDIRECT).catch((e) => e);
    expect(err).toBeInstanceOf(SignInAddressMismatchError);
    const p = describeSignInError(err);
    expect(p.kind).toBe("mismatch");
    expect(p.message).toContain("https://victim.example");
    expect(p.message).toContain("as the Base URL instead");
    expect(p.message).not.toMatch(/Advanced|Sign-in server address/);
    expect(srv.seen.map((s) => s.url)).toEqual([`${ISSUER}/.well-known/oauth-authorization-server`]);
  });

  it("holds a blank Base URL to the local default", async () => {
    // The dev proxy calls same-origin "", which means http://127.0.0.1:8787.
    const srv = fakeServer();
    await expect(beginSignIn(oauthFor({ baseUrl: "", fetch: srv.fetch }), "", REDIRECT)).rejects.toBeInstanceOf(
      SignInAddressMismatchError,
    );
    const local = fakeServer({ metadata: metadata("http://127.0.0.1:8787") });
    const { pending } = await beginSignIn(oauthFor({ baseUrl: "", fetch: local.fetch }), "", REDIRECT);
    expect(pending.issuer).toBe("http://127.0.0.1:8787");
  });

  it("refuses an issuer that is not an http(s) address, so metadata cannot run script in the app", async () => {
    const srv = fakeServer({ metadata: Response.json({ issuer: "javascript:alert(1)//" }) });
    await expect(beginSignIn(oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }), ISSUER, REDIRECT)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("reports a server without LOOMCYCLE_PUBLIC_URL as not offering sign-in", async () => {
    const srv = fakeServer({
      metadata: Response.json({ code: "oauth_issuer_unset", error: "set LOOMCYCLE_PUBLIC_URL" }, { status: 404 }),
    });
    const err = await beginSignIn(oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }), ISSUER, REDIRECT).catch((e) => e);
    expect(describeSignInError(err).kind).toBe("unsupported");
  });
});

describe("completeSignIn", () => {
  async function started() {
    const srv = fakeServer();
    const t = { baseUrl: ISSUER, fetch: srv.fetch };
    const { pending } = await beginSignIn(oauthFor(t), ISSUER, REDIRECT);
    srv.seen.length = 0;
    return { srv, t, pending };
  }

  it("exchanges the code with the verifier, redirect URI and client id, and no bearer", async () => {
    const { srv, t, pending } = await started();
    const tokens = await completeSignIn(t, pending, `${REDIRECT}?code=c1&state=${pending.state}&iss=${encodeURIComponent(ISSUER)}`);
    expect(tokens.access_token).toBe("at-1");
    expect(tokens.refresh_token).toBe("rt-1");
    expect(srv.seen).toHaveLength(1);
    const form = srv.seen[0].form!;
    expect(srv.seen[0].url).toBe(`${ISSUER}/v1/_oauth/token`);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      code: "c1",
      code_verifier: pending.verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT_ID,
    });
    expect(srv.seen[0].auth).toBeNull();
  });

  it("refuses a redirect carrying another state before spending the code", async () => {
    const { srv, t, pending } = await started();
    const err = await completeSignIn(t, pending, `${REDIRECT}?code=c1&state=forged&iss=${encodeURIComponent(ISSUER)}`).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(describeSignInError(err).kind).toBe("security");
    expect(srv.seen).toHaveLength(0);
  });

  it("refuses a redirect from another issuer before spending the code", async () => {
    const { srv, t, pending } = await started();
    const err = await completeSignIn(t, pending, `${REDIRECT}?code=c1&state=${pending.state}&iss=https%3A%2F%2Fevil.example`).catch((e) => e);
    expect((err as OAuthError).code).toBe("issuer_mismatch");
    expect(describeSignInError(err).kind).toBe("security");
    expect(srv.seen).toHaveLength(0);
  });

  it("refuses a redirect that names no issuer, since the server advertised one", async () => {
    const { srv, t, pending } = await started();
    const err = await completeSignIn(t, pending, `${REDIRECT}?code=c1&state=${pending.state}`).catch((e) => e);
    expect((err as OAuthError).code).toBe("issuer_mismatch");
    expect(srv.seen).toHaveLength(0);
  });

  it("maps an awaiting-approval refusal to the pending state", async () => {
    const { t, pending } = await started();
    const err = await completeSignIn(
      t,
      pending,
      `${REDIRECT}?error=access_denied&error_description=pending&state=${pending.state}&iss=${encodeURIComponent(ISSUER)}`,
    ).catch((e) => e);
    expect(describeSignInError(err)).toMatchObject({ kind: "pending" });
    expect(describeSignInError(err).message).toMatch(/awaiting approval/);
  });
});

describe("describeSignInError", () => {
  it("never repeats a token from the response body", () => {
    const err = new OAuthError("server_error", { status: 500, bodyText: '{"access_token":"lc_secret_value"}' });
    expect(describeSignInError(err).message).not.toContain("lc_secret_value");
  });

  it("names an unregistered client and keeps the server's reason", () => {
    const err = new OAuthError("invalid_client", { status: 403, errorDescription: "this origin may not call the token endpoint for this client" });
    const p = describeSignInError(err);
    expect(p.kind).toBe("unregistered");
    expect(p.message).toContain("this origin may not call");
  });

  it("treats a server without the sign-in routes as not offering sign-in", () => {
    expect(describeSignInError(new OAuthError("server_error", { status: 404 })).kind).toBe("unsupported");
  });

  it("reports an abandoned sign-in as cancelled", () => {
    expect(describeSignInError(new SignInCancelledError()).kind).toBe("cancelled");
  });
});
