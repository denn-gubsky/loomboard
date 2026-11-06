// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoomcycleClient } from "@loomcycle/client";
import { useSpeechCaps } from "./useSpeechCaps";

function fakeClient(over: { surfaces?: Record<string, boolean>; noSpeechInfo?: boolean } = {}) {
  const calls = {
    whoami: vi.fn(async () => ({ subject: "u1", effective: { surfaces: over.surfaces ?? { speech: true, transcription: true } } })),
    speechInfo: vi.fn(async () => ({
      speech: { enabled: true, formats: ["wav"] },
      transcription: { enabled: true, accepts: ["audio/wav"] },
    })),
  };
  const client = {
    whoami: calls.whoami,
    ...(over.noSpeechInfo ? {} : { speechInfo: calls.speechInfo }),
  } as unknown as LoomcycleClient;
  return { client, calls };
}

const BOTH = { output: true, input: true };

describe("useSpeechCaps", () => {
  it("reports each direction whoami offers, read once from speechInfo", async () => {
    const { client, calls } = fakeClient();
    const { result } = renderHook(() => useSpeechCaps(client, BOTH));
    await waitFor(() => expect(result.current.transcription).not.toBeNull());
    expect(result.current.speech).toMatchObject({ enabled: true });
    expect(calls.speechInfo).toHaveBeenCalledTimes(1);
  });

  it("reports only the direction whose surface is on", async () => {
    const { client } = fakeClient({ surfaces: { speech: false, transcription: true } });
    const { result } = renderHook(() => useSpeechCaps(client, BOTH));
    await waitFor(() => expect(result.current.transcription).not.toBeNull());
    expect(result.current.speech).toBeNull();
  });

  it("reports only the directions the host wants", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useSpeechCaps(client, { output: true, input: false }));
    await waitFor(() => expect(result.current.speech).not.toBeNull());
    expect(result.current.transcription).toBeNull();
  });

  it("does not read speechInfo when whoami reports no surface", async () => {
    const { client, calls } = fakeClient({ surfaces: {} });
    const { result } = renderHook(() => useSpeechCaps(client, BOTH));
    await waitFor(() => expect(calls.whoami).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current).toEqual({ speech: null, transcription: null });
    expect(calls.speechInfo).not.toHaveBeenCalled();
  });

  it("asks loomcycle nothing when the host turns voice off", async () => {
    const { client, calls } = fakeClient();
    renderHook(() => useSpeechCaps(client, { output: false, input: false }));
    await act(async () => undefined);
    expect(calls.whoami).not.toHaveBeenCalled();
  });

  it("offers nothing on a client that predates speechInfo", async () => {
    const { client, calls } = fakeClient({ noSpeechInfo: true });
    const { result } = renderHook(() => useSpeechCaps(client, BOTH));
    await act(async () => undefined);
    expect(result.current).toEqual({ speech: null, transcription: null });
    expect(calls.whoami).not.toHaveBeenCalled();
  });
});
