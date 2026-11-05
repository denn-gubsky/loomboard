import { describe, expect, it, vi } from "vitest";
import { createSpeechPlayer, type AudioLike, type SpeechPlayerDeps } from "./speechPlayer";

// A fake audio element: play() resolves at once, and the test decides when a
// piece ends. `played` lists every src it was asked to play, unlock included.
function fakeAudio() {
  const el: AudioLike & { played: string[]; paused: boolean; finish(): void } = {
    src: "",
    played: [],
    paused: true,
    onended: null,
    onerror: null,
    play() {
      el.played.push(el.src);
      el.paused = false;
      return Promise.resolve();
    },
    pause() {
      el.paused = true;
    },
    finish() {
      el.onended?.();
    },
  };
  return el;
}

// synthesize() calls that the test resolves or rejects by hand.
function harness(over: Partial<SpeechPlayerDeps> = {}) {
  const el = fakeAudio();
  const calls: { text: string; signal: AbortSignal; resolve(b: Blob): void; reject(e: unknown): void }[] = [];
  const urls = new Set<string>();
  let n = 0;
  const deps: SpeechPlayerDeps = {
    synthesize: (text, signal) =>
      new Promise<Blob>((resolve, reject) => calls.push({ text, signal, resolve, reject })),
    createAudio: () => el,
    createObjectURL: () => {
      const u = `blob:${++n}`;
      urls.add(u);
      return u;
    },
    revokeObjectURL: (u) => urls.delete(u),
    describe: (e) => (e instanceof Error ? e.message : String(e)),
    isUnavailable: (e) => (e as { status?: number }).status === 403,
    ...over,
  };
  const player = createSpeechPlayer(deps);
  return { player, el, calls, urls };
}

const audio = (text: string) => new Blob([text], { type: "audio/wav" });
const tick = () => new Promise((r) => setTimeout(r, 0));
const SILENCE_PREFIX = "data:audio/wav;base64,";

describe("speechPlayer", () => {
  it("unlocks the audio element before the first await", () => {
    const { player, el } = harness();
    player.play("m1", ["Hello."]);
    expect(el.played).toHaveLength(1);
    expect(el.played[0].startsWith(SILENCE_PREFIX)).toBe(true);
    expect(player.getState()).toMatchObject({ key: "m1", status: "loading" });
  });

  it("plays the pieces in order and prefetches the next piece while the current one plays", async () => {
    const { player, el, calls } = harness();
    player.play("m1", ["One.", "Two.", "Three."]);
    expect(calls.map((c) => c.text)).toEqual(["One."]);

    calls[0].resolve(audio("1"));
    await tick();
    expect(player.getState().status).toBe("playing");
    expect(el.played.at(-1)).toBe("blob:1");
    // Piece two was asked for as soon as piece one was in hand, not after it ended.
    expect(calls.map((c) => c.text)).toEqual(["One.", "Two."]);

    calls[1].resolve(audio("2"));
    el.finish();
    await tick();
    expect(el.played.at(-1)).toBe("blob:2");
    expect(calls.map((c) => c.text)).toEqual(["One.", "Two.", "Three."]);

    calls[2].resolve(audio("3"));
    el.finish();
    await tick();
    el.finish();
    await tick();
    expect(player.getState()).toMatchObject({ key: null, status: "idle", error: null });
  });

  it("shows loading between pieces only when the next one is not back yet", async () => {
    const { player, el, calls } = harness();
    player.play("m1", ["One.", "Two."]);
    calls[0].resolve(audio("1"));
    await tick();
    el.finish();
    await tick();
    expect(player.getState().status).toBe("loading");
    calls[1].resolve(audio("2"));
    await tick();
    expect(player.getState().status).toBe("playing");
  });

  it("revokes object URLs when a piece ends and when playback stops", async () => {
    const { player, el, calls, urls } = harness();
    player.play("m1", ["One.", "Two."]);
    calls[0].resolve(audio("1"));
    await tick();
    expect(urls.size).toBe(1);
    calls[1].resolve(audio("2"));
    el.finish();
    await tick();
    expect([...urls]).toEqual(["blob:2"]);
    player.stop();
    expect(urls.size).toBe(0);
    expect(el.paused).toBe(true);
    expect(player.getState()).toMatchObject({ key: null, status: "idle" });
  });

  it("aborts the request in flight when stopped, without reporting an error", async () => {
    const { player, calls } = harness();
    player.play("m1", ["One."]);
    player.stop();
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].reject(new DOMException("aborted", "AbortError"));
    await tick();
    expect(player.getState()).toMatchObject({ key: null, status: "idle", error: null });
  });

  it("stops the previous reading when another reply starts", async () => {
    const { player, el, calls } = harness();
    player.play("m1", ["First reply."]);
    calls[0].resolve(audio("1"));
    await tick();
    player.play("m2", ["Second reply."]);
    expect(calls[0].signal.aborted).toBe(true);
    expect(player.getState()).toMatchObject({ key: "m2", status: "loading" });
    calls[1].resolve(audio("2"));
    await tick();
    expect(player.getState()).toMatchObject({ key: "m2", status: "playing" });
    // The first reply's end must not advance or end the second.
    expect(el.played.at(-1)).toBe("blob:2");
  });

  it("pauses and resumes the piece that is playing", async () => {
    const { player, el, calls } = harness();
    player.play("m1", ["One."]);
    calls[0].resolve(audio("1"));
    await tick();
    player.pause();
    expect(el.paused).toBe(true);
    expect(player.getState().status).toBe("paused");
    player.resume();
    expect(el.paused).toBe(false);
    expect(player.getState().status).toBe("playing");
  });

  it("reports a failed piece on the reply it was reading", async () => {
    const { player, calls } = harness();
    player.play("m1", ["One."]);
    calls[0].reject(new Error("the speech engine failed; try again later"));
    await tick();
    expect(player.getState()).toMatchObject({
      key: null,
      status: "idle",
      error: { key: "m1", message: "the speech engine failed; try again later" },
      unavailable: false,
    });
  });

  it("marks read-aloud unavailable when the server refuses it", async () => {
    const { player, calls } = harness();
    player.play("m1", ["One."]);
    calls[0].reject(Object.assign(new Error("forbidden"), { status: 403 }));
    await tick();
    expect(player.getState().unavailable).toBe(true);
  });

  it("reads a reply again from the cache without asking the server", async () => {
    const { player, el, calls } = harness();
    player.play("m1", ["One."]);
    calls[0].resolve(audio("1"));
    await tick();
    el.finish();
    await tick();
    player.play("m1", ["One."]);
    await tick();
    expect(calls).toHaveLength(1);
    expect(player.getState().status).toBe("playing");
  });

  it("evicts the oldest audio when the cache is over its size", async () => {
    const synthesize = vi.fn(async (text: string) => audio(text.repeat(10)));
    const { player, el } = harness({ synthesize, cacheBytes: 25 });
    for (const t of ["a.", "b.", "a."]) {
      player.play(t, [t]);
      await tick();
      el.finish();
      await tick();
    }
    // "a." (20 bytes) was pushed out by "b." (20 bytes) under a 25-byte cache.
    expect(synthesize.mock.calls.map((c) => c[0])).toEqual(["a.", "b.", "a."]);
  });

  it("notifies subscribers on every change", async () => {
    const { player, calls } = harness();
    const seen: string[] = [];
    player.subscribe(() => seen.push(player.getState().status));
    player.play("m1", ["One."]);
    calls[0].resolve(audio("1"));
    await tick();
    player.stop();
    expect(seen).toEqual(["loading", "playing", "idle"]);
  });
});
