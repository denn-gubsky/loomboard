import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenProvider } from "@loomcycle/client";
import { buildConnection } from "./buildConnection";
import { createLoomcycleClient } from "../chat/lib/createClient";

afterEach(() => vi.unstubAllGlobals());

describe("buildConnection", () => {
  it("hands a signed-in connection no static token, and signs its requests with the current one", async () => {
    vi.stubGlobal("location", new URL("http://127.0.0.1:5173/"));
    const seen: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("Authorization"));
        return Response.json({ subject: "ada", tenant_id: "acme", scopes: [] });
      }),
    );
    let current = "at-1";
    const signIn: TokenProvider & { baseUrl: string } = { getToken: async () => current, baseUrl: "http://127.0.0.1:8787" };
    const conn = buildConnection({ baseUrl: "http://127.0.0.1:8787", token: "", auth: "oauth" }, signIn);
    expect(conn.token).toBeUndefined();
    // An embedded surface builds its own client from the Connection, as <Chat>
    // and the @loomcycle/* packages do; it stays signed in across a refresh.
    const client = createLoomcycleClient(conn);
    await client.whoami();
    current = "at-2";
    await client.whoami();
    expect(seen).toEqual(["Bearer at-1", "Bearer at-2"]);
  });

  it("never lends a sign-in to a token connection or to another server", async () => {
    vi.stubGlobal("location", new URL("http://127.0.0.1:5173/"));
    const seen: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("Authorization"));
        return Response.json({ subject: "ada", tenant_id: "acme", scopes: [] });
      }),
    );
    // A sign-in to server A, still in hand while the settings say otherwise.
    const signIn = Object.assign({ getToken: async () => "at-a" }, { baseUrl: "https://a.example" });
    const token = buildConnection({ baseUrl: "https://b.example", token: "lc_b" }, signIn);
    expect(token.token).toBe("lc_b");
    await createLoomcycleClient(token).whoami();
    const other = buildConnection({ baseUrl: "https://b.example", token: "", auth: "oauth" }, signIn);
    await createLoomcycleClient(other).whoami();
    expect(seen).toEqual(["Bearer lc_b", null]);
  });

  it("keeps the pasted token for a token connection", () => {
    expect(buildConnection({ baseUrl: "https://lc.example", token: "lc_x" }).token).toBe("lc_x");
  });
});
