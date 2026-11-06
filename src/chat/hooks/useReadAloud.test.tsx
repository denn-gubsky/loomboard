// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoomcycleClient, SpeechDirectionInfo } from "@loomcycle/client";
import { useReadAloud } from "./useReadAloud";

// jsdom implements neither media playback nor object URLs. Record what each
// audio element was asked to play, and hand out fake blob: URLs.
let srcs: string[];
let paused: number;
beforeEach(() => {
  srcs = [];
  paused = 0;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    srcs.push(this.src);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
    paused++;
  });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

const INFO: SpeechDirectionInfo = { enabled: true, formats: ["wav"], languages: { uk: { voices: ["ukrainian_tts"], default_voice: "ukrainian_tts" }, en: { voices: ["af_heart"], default_voice: "af_heart" } } };

function fakeClient() {
  const calls = {
    speech: vi.fn(async (_input: string, _opts?: Record<string, unknown>) => ({ bytes: new Uint8Array([82, 73, 70, 70]), contentType: "audio/wav" })),
  };
  return { client: { speech: calls.speech } as unknown as LoomcycleClient, calls };
}

describe("useReadAloud", () => {
  it("offers nothing without the speech direction", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useReadAloud(client, null, "c1"));
    expect(result.current).toBeNull();
  });

  it("reads each piece through client.speech in the chosen format, with a signal to cancel", async () => {
    const { client, calls } = fakeClient();
    const { result } = renderHook(() => useReadAloud(client, INFO, "c1"));
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.play("0", "Привіт, це перевірка голосу."));
    await waitFor(() => expect(result.current!.state.status).toBe("playing"));
    expect(calls.speech).toHaveBeenCalledWith("Привіт, це перевірка голосу.", {
      format: "wav",
      signal: expect.any(AbortSignal),
    });
  });

  it("names en for an English piece, and leaves a Ukrainian one to loomcycle", async () => {
    const { client, calls } = fakeClient();
    const { result } = renderHook(() => useReadAloud(client, INFO, "c1"));
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.play("0", "Привіт, це перевірка голосу.\n\n" + "Leaves change colour. ".repeat(40)));
    await waitFor(() => expect(calls.speech).toHaveBeenCalledTimes(2));
    expect(calls.speech.mock.calls[0][1]).not.toHaveProperty("language");
    expect(calls.speech.mock.calls[1][1]).toMatchObject({ language: "en" });
  });

  it("never puts the bearer token in an audio URL: it plays only blob: URLs and the unlock clip", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useReadAloud(client, INFO, "c1"));
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.play("0", "Hello."));
    await waitFor(() => expect(result.current!.state.status).toBe("playing"));
    expect(srcs.length).toBe(2);
    expect(srcs[0]).toMatch(/^data:audio\/wav;base64,/);
    expect(srcs[1]).toMatch(/^blob:/);
  });

  it("stops reading when the conversation changes", async () => {
    const { client } = fakeClient();
    const { result, rerender } = renderHook(({ id }) => useReadAloud(client, INFO, id), {
      initialProps: { id: "c1" },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.play("0", "Hello."));
    await waitFor(() => expect(result.current!.state.status).toBe("playing"));
    rerender({ id: "c2" });
    expect(result.current!.state).toMatchObject({ key: null, status: "idle" });
    expect(paused).toBeGreaterThan(0);
  });
});
