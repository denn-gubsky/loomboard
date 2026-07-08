import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchToTab } from "./dispatch";
import type { BrowserCommand, BrowserResult } from "./protocol";

const CMD: BrowserCommand = { id: "c1", op: "read_page" };
const OK: BrowserResult = { id: "c1", ok: true, op: "read_page" };

// Minimal chrome mock. sendMessage/executeScript are supplied per test so we can
// drive the "no listener → inject → retry" path.
function installChrome(opts: {
  sendMessage: ReturnType<typeof vi.fn>;
  executeScript?: ReturnType<typeof vi.fn>;
}) {
  const executeScript = opts.executeScript ?? vi.fn(async () => []);
  vi.stubGlobal("chrome", {
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: opts.sendMessage,
      update: vi.fn(),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: { executeScript },
    runtime: {
      getManifest: () => ({ content_scripts: [{ js: ["assets/loader.js"] }] }),
    },
  });
  return { executeScript };
}

afterEach(() => vi.unstubAllGlobals());

describe("dispatchToTab self-healing injection", () => {
  it("injects the content script and retries when the tab has no listener", async () => {
    // First send rejects (no receiver); after injection the retry succeeds.
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not establish connection"))
      .mockResolvedValue(OK);
    const { executeScript } = installChrome({ sendMessage });

    const res = await dispatchToTab(CMD);

    expect(res.ok).toBe(true);
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ["assets/loader.js"],
    });
    expect(sendMessage).toHaveBeenCalledTimes(2); // initial miss + post-inject retry
  });

  it("does not inject when the content script answers on the first try", async () => {
    const sendMessage = vi.fn().mockResolvedValue(OK);
    const { executeScript } = installChrome({ sendMessage });

    const res = await dispatchToTab(CMD);

    expect(res.ok).toBe(true);
    expect(executeScript).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("reports the page uncontrollable when injection is refused (restricted page)", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("no receiver"));
    // executeScript throws on chrome:// / web store / PDF viewers.
    const executeScript = vi.fn().mockRejectedValue(new Error("Cannot access"));
    installChrome({ sendMessage, executeScript });

    const res = await dispatchToTab(CMD);

    expect(res.ok).toBe(false);
    expect(res.error).toContain("can't be controlled");
    expect(executeScript).toHaveBeenCalledTimes(1);
  });
});
