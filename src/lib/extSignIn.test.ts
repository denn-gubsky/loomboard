import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInAddressMismatchError, SignInCancelledError } from "./appSignIn";
import { extSignIn, type ChromeIdentity } from "./extSignIn";

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
const REDIRECT = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/";

let forms: URLSearchParams[];
beforeEach(() => {
  forms = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/.well-known/oauth-authorization-server")) return metadata();
      forms.push(new URLSearchParams(String(init?.body)));
      return Response.json({ access_token: "at-1", token_type: "Bearer", expires_in: 3600, refresh_token: "rt-1" });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function identity(land: (authorizeUrl: URL) => Promise<string | undefined>): ChromeIdentity & { launched: URL[] } {
  const launched: URL[] = [];
  return {
    launched,
    getRedirectURL: () => REDIRECT,
    launchWebAuthFlow: async ({ url, interactive }) => {
      expect(interactive).toBe(true);
      const u = new URL(url);
      launched.push(u);
      return land(u);
    },
  };
}

describe("extSignIn", () => {
  it("signs in through launchWebAuthFlow with the extension's chromiumapp.org redirect", async () => {
    const id = identity(async (u) => `${REDIRECT}?code=c1&state=${u.searchParams.get("state")}&iss=${encodeURIComponent(ISSUER)}`);
    const tokens = await extSignIn(ISSUER, id);
    expect(tokens.refresh_token).toBe("rt-1");
    expect(id.launched[0].searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(forms[0].get("redirect_uri")).toBe(REDIRECT);
  });

  it("refuses another server's sign-in before opening the sign-in window", async () => {
    issuer = "https://victim.example";
    try {
      const id = identity(async () => undefined);
      await expect(extSignIn(ISSUER, id)).rejects.toBeInstanceOf(SignInAddressMismatchError);
      expect(id.launched).toHaveLength(0);
    } finally {
      issuer = ISSUER;
    }
  });

  it("reports a closed window as a cancelled sign-in", async () => {
    const id = identity(async () => {
      throw new Error("The user did not approve access.");
    });
    await expect(extSignIn(ISSUER, id)).rejects.toBeInstanceOf(SignInCancelledError);
    expect(forms).toHaveLength(0);
  });

  it("refuses a response for another sign-in before spending its code", async () => {
    const id = identity(async () => `${REDIRECT}?code=c1&state=other&iss=${encodeURIComponent(ISSUER)}`);
    await expect(extSignIn(ISSUER, id)).rejects.toMatchObject({ code: "state_mismatch" });
    expect(forms).toHaveLength(0);
  });
});
