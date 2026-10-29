import { describe, expect, it, vi } from "vitest";
import type { PendingSignIn } from "../lib/appSignIn";
import {
  chromeSessionRefreshStore,
  keychainRefreshStore,
  savePendingSignIn,
  takePendingSignIn,
  webRefreshStore,
  type Invoke,
} from "./signInStore";
import { parseConnectionSettings, signInSettings } from "./settings";

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
  dump() {
    return [...this.m.values()].join("\n");
  }
}

const BASE = "https://lc.example";

describe("webRefreshStore", () => {
  it("returns the refresh token only for the server it was issued by", async () => {
    const s = webRefreshStore(new MemoryStorage());
    await s.save({ baseUrl: BASE, refreshToken: "rt-1" });
    expect(await s.load(BASE)).toBe("rt-1");
    expect(await s.load("https://other.example")).toBeNull();
    await s.clear();
    expect(await s.load(BASE)).toBeNull();
  });
});

describe("chromeSessionRefreshStore", () => {
  it("keeps the sign-in in chrome.storage.session", async () => {
    const data: Record<string, unknown> = {};
    const area = {
      get: vi.fn(async (k: string) => ({ [k]: data[k] })),
      set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(data, items)),
      remove: vi.fn(async (k: string) => void delete data[k]),
    } as unknown as chrome.storage.StorageArea;
    const s = chromeSessionRefreshStore(area);
    await s.save({ baseUrl: BASE, refreshToken: "rt-1" });
    expect(await s.load(BASE)).toBe("rt-1");
    await s.clear();
    expect(await s.load(BASE)).toBeNull();
  });
});

describe("keychainRefreshStore", () => {
  it("reads and writes only the app's fixed keychain entry", async () => {
    let held: string | null = null;
    const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "sign_in_secret_get") return held;
      if (cmd === "sign_in_secret_set") held = args?.value as string;
      if (cmd === "sign_in_secret_delete") held = null;
      return undefined;
    }) as unknown as Invoke;
    const s = keychainRefreshStore(invoke);
    await s.save({ baseUrl: BASE, refreshToken: "rt-1" });
    expect(await s.load(BASE)).toBe("rt-1");
    await s.clear();
    expect(await s.load(BASE)).toBeNull();
    const cmds = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(new Set(cmds)).toEqual(new Set(["sign_in_secret_get", "sign_in_secret_set", "sign_in_secret_delete"]));
  });
});

describe("takePendingSignIn", () => {
  const pending: PendingSignIn = {
    baseUrl: BASE,
    issuer: BASE,
    redirectUri: "https://board.example/auth/callback",
    state: "s1",
    verifier: "v1",
  };

  it("hands a sign-in in progress back once, so a reloaded callback cannot replay it", () => {
    const st = new MemoryStorage();
    savePendingSignIn(st, pending);
    expect(takePendingSignIn(st)).toEqual(pending);
    expect(takePendingSignIn(st)).toBeNull();
    expect(st.length).toBe(0);
  });

  it("drops a malformed record", () => {
    const st = new MemoryStorage();
    st.setItem("loomboard.signin.pending", JSON.stringify({ state: "s1" }));
    expect(takePendingSignIn(st)).toBeNull();
  });
});

describe("signInSettings", () => {
  it("persists that a connection is a sign-in, and never a token with it", () => {
    const s = signInSettings(BASE);
    expect(JSON.stringify(s)).not.toMatch(/rt-|at-/);
    expect(s.token).toBe("");
    // A record claiming a sign-in never carries a token back in.
    expect(parseConnectionSettings({ baseUrl: BASE, token: "lc_leaked", auth: "oauth" })).toEqual(s);
    expect(parseConnectionSettings({ baseUrl: BASE, token: "lc_pasted" })).toEqual({ baseUrl: BASE, token: "lc_pasted" });
  });

  it("drops a persisted sign-in server address, which could point the sign-in elsewhere", () => {
    const s = parseConnectionSettings({ baseUrl: BASE, token: "", auth: "oauth", signInAddress: "https://other.example" });
    expect(s).toEqual({ baseUrl: BASE, token: "", auth: "oauth" });
  });
});
