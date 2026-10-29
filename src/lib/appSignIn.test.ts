import { describe, expect, it, vi } from "vitest";
import { LoomcycleClient, OAuthError, pkceChallenge } from "@loomcycle/client";
import {
  CLIENT_ID,
  SignInAddressMismatchError,
  SignInCancelledError,
  beginSignIn,
  completeSignIn,
  describeSignInError,
  oauthFor,
  resumeTokens,
  signInAddress,
  startTokenProvider,
  type RefreshTokenStore,
  type StoredSignIn,
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

function memoryStore(): RefreshTokenStore & { saved: StoredSignIn[] } {
  const saved: StoredSignIn[] = [];
  return {
    saved,
    load: async () => saved.at(-1)?.refreshToken ?? null,
    save: async (s) => {
      saved.push(s);
    },
    clear: async () => {
      saved.length = 0;
    },
  };
}

describe("beginSignIn", () => {
  it("proceeds when the server's issuer is on the Base URL's origin", async () => {
    const srv = fakeServer();
    // Trailing slashes do not matter; the origin does.
    const { url, pending } = await beginSignIn(
      oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }),
      ISSUER,
      REDIRECT,
      signInAddress(`${ISSUER}/`),
    );
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/v1/_oauth/authorize`);
    expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe(await pkceChallenge(pending.verifier));
    expect(u.searchParams.get("state")).toBe(pending.state);
    expect(pending).toMatchObject({ baseUrl: ISSUER, issuer: ISSUER, redirectUri: REDIRECT });
    // The verifier is a secret until the exchange: never in the URL.
    expect(url).not.toContain(pending.verifier);
    expect(srv.seen.map((s) => s.url)).toEqual([`${ISSUER}/.well-known/oauth-authorization-server`]);
  });

  it("refuses a server whose metadata names another server's sign-in, before sending the person anywhere", async () => {
    // A hostile server (or proxy) at the Base URL naming a real loomcycle's
    // issuer, to catch the code that loomcycle would send back.
    const srv = fakeServer({ metadata: metadata("https://victim.example") });
    const err = await beginSignIn(
      oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }),
      ISSUER,
      REDIRECT,
      signInAddress(ISSUER),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SignInAddressMismatchError);
    const p = describeSignInError(err);
    expect(p.kind).toBe("mismatch");
    expect(p.message).toContain("https://victim.example");
    expect(srv.seen.map((s) => s.url)).toEqual([`${ISSUER}/.well-known/oauth-authorization-server`]);
  });

  it("accepts another issuer only when the person set it as the sign-in server address", async () => {
    const srv = fakeServer();
    // The dev proxy: the app calls same-origin "" for the default local
    // loomcycle, whose public address is set explicitly under Advanced.
    const { pending } = await beginSignIn(
      oauthFor({ baseUrl: "", fetch: srv.fetch }),
      "",
      REDIRECT,
      signInAddress("", ISSUER),
    );
    expect(pending.issuer).toBe(ISSUER);
    await expect(
      beginSignIn(oauthFor({ baseUrl: "", fetch: srv.fetch }), "", REDIRECT, signInAddress("")),
    ).rejects.toBeInstanceOf(SignInAddressMismatchError);
  });

  it("refuses metadata whose token or revocation endpoint is on another origin", async () => {
    for (const over of [
      { token_endpoint: "https://evil.example/v1/_oauth/token" },
      { revocation_endpoint: "https://evil.example/v1/_oauth/revoke" },
      { authorization_endpoint: "https://evil.example/v1/_oauth/authorize" },
    ]) {
      const srv = fakeServer({ metadata: metadata(ISSUER, over) });
      await expect(
        beginSignIn(oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }), ISSUER, REDIRECT, ISSUER),
      ).rejects.toBeInstanceOf(SignInAddressMismatchError);
    }
  });

  it("refuses an issuer that is not an http(s) address, so metadata cannot run script in the app", async () => {
    const srv = fakeServer({ metadata: Response.json({ issuer: "javascript:alert(1)//" }) });
    await expect(beginSignIn(oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }), ISSUER, REDIRECT, ISSUER)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("reports a server without LOOMCYCLE_PUBLIC_URL as not offering sign-in", async () => {
    const srv = fakeServer({
      metadata: Response.json({ code: "oauth_issuer_unset", error: "set LOOMCYCLE_PUBLIC_URL" }, { status: 404 }),
    });
    const err = await beginSignIn(oauthFor({ baseUrl: ISSUER, fetch: srv.fetch }), ISSUER, REDIRECT, ISSUER).catch((e) => e);
    expect(describeSignInError(err).kind).toBe("unsupported");
  });
});

describe("completeSignIn", () => {
  async function started() {
    const srv = fakeServer();
    const t = { baseUrl: ISSUER, fetch: srv.fetch };
    const { pending } = await beginSignIn(oauthFor(t), ISSUER, REDIRECT, ISSUER);
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

describe("startTokenProvider", () => {
  it("stores every rotated refresh token for its server before the new access token is used", async () => {
    const srv = fakeServer();
    const store = memoryStore();
    const provider = startTokenProvider({
      t: { baseUrl: ISSUER, fetch: srv.fetch },
      baseUrl: ISSUER,
      tokens: resumeTokens("rt-stored"),
      store,
      onSignedOut: () => undefined,
    });
    // A resumed sign-in has no access token: the first request refreshes.
    expect(await provider.getToken()).toBe("at-1");
    expect(srv.seen[0].form?.get("grant_type")).toBe("refresh_token");
    expect(srv.seen[0].form?.get("refresh_token")).toBe("rt-stored");
    expect(store.saved).toEqual([{ baseUrl: ISSUER, refreshToken: "rt-1" }]);
  });

  it("gives a client the current token and ends the sign-in when the server refuses the refresh", async () => {
    const srv = fakeServer({
      token: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    });
    const onSignedOut = vi.fn();
    const provider = startTokenProvider({
      t: { baseUrl: ISSUER, fetch: srv.fetch },
      baseUrl: ISSUER,
      tokens: resumeTokens("rt-revoked"),
      store: memoryStore(),
      onSignedOut,
    });
    const client = new LoomcycleClient({ baseUrl: ISSUER, tokenProvider: provider, fetch: srv.fetch });
    await expect(client.whoami()).rejects.toBeInstanceOf(OAuthError);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect((onSignedOut.mock.calls[0][0] as OAuthError).code).toBe("invalid_grant");
  });

  it("signs out by revoking the refresh token (RFC 7009) and forgetting the tokens", async () => {
    const srv = fakeServer();
    const onSignedOut = vi.fn();
    const provider = startTokenProvider({
      t: { baseUrl: ISSUER, fetch: srv.fetch },
      baseUrl: ISSUER,
      tokens: { access_token: "at-0", token_type: "Bearer", expires_in: 3600, refresh_token: "rt-0", expires_at: Date.now() + 3_600_000 },
      store: memoryStore(),
      onSignedOut,
    });
    await provider.signOut();
    const revoke = srv.seen.find((s) => s.url.endsWith("/v1/_oauth/revoke"));
    expect(Object.fromEntries(revoke!.form!)).toEqual({ token: "rt-0", client_id: CLIENT_ID });
    expect(provider.tokens).toBeUndefined();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    await expect(provider.getToken()).rejects.toBeInstanceOf(OAuthError);
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
