import { describe, it, expect } from "vitest";
import { devConnectSettings } from "./devConnect";

const persisted = { baseUrl: "http://persisted:8787", token: "kept" };

describe("devConnectSettings", () => {
  it("seeds a connection from the dev env when nothing is stored", () => {
    expect(
      devConnectSettings(
        { DEV: true, VITE_DEV_TOKEN: "t", VITE_DEV_BASE_URL: "http://192.168.0.77:8787" },
        null,
      ),
    ).toEqual({ baseUrl: "http://192.168.0.77:8787", token: "t" });
  });

  it("leaves the base URL blank so dev falls through to the proxy's own target", () => {
    expect(devConnectSettings({ DEV: true, VITE_DEV_TOKEN: "t" }, null)).toEqual({
      baseUrl: "",
      token: "t",
    });
  });

  // THE SAFETY PROPERTY. DEV is the literal `false` in any `vite build`, so this
  // is also what makes the branch dead code the minifier drops — a token in the
  // environment at build time must never reach a shipped bundle.
  it("never seeds outside dev, whatever the environment holds", () => {
    expect(devConnectSettings({ DEV: false, VITE_DEV_TOKEN: "t" }, null)).toBeNull();
    expect(devConnectSettings({ VITE_DEV_TOKEN: "t" }, null)).toBeNull();
  });

  it("yields to a stored connection so the UI can still point elsewhere", () => {
    expect(devConnectSettings({ DEV: true, VITE_DEV_TOKEN: "t" }, persisted)).toBeNull();
  });

  it("stays off when no dev token is given", () => {
    expect(devConnectSettings({ DEV: true }, null)).toBeNull();
    expect(devConnectSettings({ DEV: true, VITE_DEV_TOKEN: "" }, null)).toBeNull();
  });
});
