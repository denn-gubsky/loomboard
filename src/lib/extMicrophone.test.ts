import { describe, expect, it, vi } from "vitest";
import { ensureExtensionMicrophone } from "./extMicrophone";

function deps(state: PermissionState | Error) {
  return {
    query: vi.fn(async () => {
      if (state instanceof Error) throw state;
      return state;
    }),
    openPermissionPage: vi.fn(),
  };
}

describe("ensureExtensionMicrophone", () => {
  it("records at once when the extension already has the microphone", async () => {
    const d = deps("granted");
    expect(await ensureExtensionMicrophone(d)).toBe(true);
    expect(d.openPermissionPage).not.toHaveBeenCalled();
  });

  it("opens the permission page and skips this take when the microphone was never asked for", async () => {
    const d = deps("prompt");
    expect(await ensureExtensionMicrophone(d)).toBe(false);
    expect(d.openPermissionPage).toHaveBeenCalledOnce();
  });

  it("leaves a denied microphone to getUserMedia, so the chat says it was denied", async () => {
    const d = deps("denied");
    expect(await ensureExtensionMicrophone(d)).toBe(true);
    expect(d.openPermissionPage).not.toHaveBeenCalled();
  });

  it("sends the person to the permission page when Chrome cannot say", async () => {
    const d = deps(new TypeError("microphone is not a valid permission name"));
    expect(await ensureExtensionMicrophone(d)).toBe(false);
    expect(d.openPermissionPage).toHaveBeenCalledOnce();
  });
});
