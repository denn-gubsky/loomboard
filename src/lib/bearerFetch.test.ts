import { describe, expect, it, vi } from "vitest";
import type { TokenProvider } from "@loomcycle/client";
import { apiPrefix, bearerFetch } from "./bearerFetch";

function recorder(statuses: number[] = []) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    return new Response(null, { status: statuses.shift() ?? 200 });
  });
  return { calls, fetch: fetchImpl as unknown as typeof fetch };
}

function provider(tokens: string[]): TokenProvider & { refused: (string | undefined)[] } {
  const refused: (string | undefined)[] = [];
  let i = 0;
  return {
    refused,
    getToken: async () => tokens[i],
    onUnauthorized: async (rejected) => {
      refused.push(rejected);
      i++;
      return tokens[i];
    },
  };
}

describe("apiPrefix", () => {
  it("is the base URL's /v1/, keeping a path prefix and dropping trailing slashes", () => {
    expect(apiPrefix("https://lc.example")).toBe("https://lc.example/v1/");
    expect(apiPrefix("https://lc.example/loom//")).toBe("https://lc.example/loom/v1/");
  });

  it("is the page's own origin for the same-origin dev proxy", () => {
    expect(apiPrefix("", "http://127.0.0.1:5173/chat?x=1")).toBe("http://127.0.0.1:5173/v1/");
  });
});

describe("bearerFetch", () => {
  const prefix = "https://lc.example/v1/";

  it("retries a Request with a body after a 401 without re-sending a consumed body", async () => {
    // A fetch reads a Request's body, so the same Request cannot be sent twice.
    const bodies: string[] = [];
    let status = 401;
    const inner = (async (input: RequestInfo | URL) => {
      bodies.push(await (input as Request).text());
      const r = new Response(null, { status });
      status = 200;
      return r;
    }) as typeof fetch;
    const f = bearerFetch(inner, provider(["at-1", "at-2"]), prefix);
    const res = await f(new Request(`${prefix}runs`, { method: "POST", body: '{"agent":"a"}' }));
    expect(res.status).toBe(200);
    expect(bodies).toEqual(['{"agent":"a"}', '{"agent":"a"}']);
  });

  it("sends the current access token to the connected loomcycle's API", async () => {
    const r = recorder();
    const f = bearerFetch(r.fetch, provider(["at-1"]), prefix);
    await f("https://lc.example/v1/_me", { headers: { Accept: "application/json" } });
    expect(r.calls).toEqual([{ url: "https://lc.example/v1/_me", auth: "Bearer at-1" }]);
  });

  it("never sends the token to another origin, or to a non-API path of the same one", async () => {
    const r = recorder();
    const p = provider(["at-1"]);
    const getToken = vi.spyOn(p, "getToken");
    const f = bearerFetch(r.fetch, p, prefix);
    await f("https://lc.example.evil.test/v1/_me");
    await f("https://lc.example/ui/login");
    await f("https://lc.example/v1/../ui/x");
    await f("http://lc.example/v1/_me");
    expect(r.calls.every((c) => c.auth === null)).toBe(true);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("resolves the dev proxy's relative URLs against the page", async () => {
    const r = recorder();
    const f = bearerFetch(r.fetch, provider(["at-1"]), "http://127.0.0.1:5173/v1/", "http://127.0.0.1:5173/");
    await f("/v1/agents");
    expect(r.calls[0].auth).toBe("Bearer at-1");
  });

  it("retries once with a fresh token after a 401, and lets a second 401 stand", async () => {
    const r = recorder([401, 401]);
    const p = provider(["at-1", "at-2", "at-3"]);
    const f = bearerFetch(r.fetch, p, prefix);
    const resp = await f("https://lc.example/v1/_me");
    expect(resp.status).toBe(401);
    expect(r.calls.map((c) => c.auth)).toEqual(["Bearer at-1", "Bearer at-2"]);
    expect(p.refused).toEqual(["at-1"]);
  });
});
