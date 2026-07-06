import { describe, it, expect } from "vitest";
import { approval } from "./approval";
import { isMutating, type BrowserCommand } from "./protocol";

function cmd(id: string): BrowserCommand {
  return { id, op: "click" };
}

describe("approval mediator", () => {
  it("resolves true when approved", async () => {
    const p = approval.request(cmd("1"));
    let pending: { cmd: BrowserCommand; approve: () => void } | null = null;
    const unsub = approval.subscribe((x) => (pending = x));
    expect(pending!.cmd.id).toBe("1");
    pending!.approve();
    await expect(p).resolves.toBe(true);
    unsub();
  });

  it("resolves false when rejected", async () => {
    const p = approval.request(cmd("2"));
    let pending: { reject: () => void } | null = null;
    const unsub = approval.subscribe((x) => (pending = x));
    pending!.reject();
    await expect(p).resolves.toBe(false);
    unsub();
  });

  it("cancelPending rejects the in-flight request", async () => {
    const p = approval.request(cmd("3"));
    approval.cancelPending();
    await expect(p).resolves.toBe(false);
  });

  it("notifies subscribers of the pending action and its clearing", async () => {
    const seen: (string | null)[] = [];
    const unsub = approval.subscribe((x) => seen.push(x?.cmd.id ?? null));
    const p = approval.request(cmd("4"));
    approval.cancelPending();
    await p;
    unsub();
    expect(seen).toContain("4");
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("a superseding request rejects the previous pending action", async () => {
    const first = approval.request(cmd("5"));
    const second = approval.request(cmd("6"));
    await expect(first).resolves.toBe(false);
    approval.cancelPending();
    await expect(second).resolves.toBe(false);
  });
});

describe("isMutating", () => {
  it("flags fill/click/navigate and not the read-only ops", () => {
    expect(isMutating("fill")).toBe(true);
    expect(isMutating("click")).toBe(true);
    expect(isMutating("navigate")).toBe(true);
    expect(isMutating("read_page")).toBe(false);
    expect(isMutating("get_selection")).toBe(false);
  });
});
