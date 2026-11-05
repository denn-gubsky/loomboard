import { describe, expect, it } from "vitest";
import { WAV_RATE, encodeWav, mixToMono, resample } from "./wav";

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));

describe("encodeWav", () => {
  it("encodes 16-bit mono PCM with a correct RIFF header", () => {
    const b = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), WAV_RATE);
    const v = new DataView(b.buffer);
    expect(b.length).toBe(44 + 5 * 2);
    expect(text(b, 0, 4)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(b.length - 8);
    expect(text(b, 8, 8)).toBe("WAVEfmt ");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(28, true)).toBe(32_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(text(b, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 16383, -16384, 32767, -32768]);
  });

  it("clips samples outside -1..1", () => {
    const v = new DataView(encodeWav(new Float32Array([3, -3]), WAV_RATE).buffer);
    expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([32767, -32768]);
  });
});

describe("mixToMono", () => {
  it("averages the channels", () => {
    expect(Array.from(mixToMono([new Float32Array([1, 0.5]), new Float32Array([0, 0.5])]))).toEqual([0.5, 0.5]);
  });

  it("returns a single channel as it is", () => {
    const one = new Float32Array([0.1, 0.2]);
    expect(mixToMono([one])).toBe(one);
  });
});

describe("resample", () => {
  const tone = (rate: number, seconds: number, hz: number) =>
    Float32Array.from({ length: rate * seconds }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));

  it("resamples a 48 kHz recording to 16 kHz without changing its duration", () => {
    const out = resample(tone(48_000, 2, 440), 48_000, 16_000);
    expect(out.length).toBe(32_000);
  });

  it("resamples 44.1 kHz to 16 kHz, keeping a speech-band tone", () => {
    const out = resample(tone(44_100, 1, 300), 44_100, 16_000);
    expect(out.length).toBe(16_000);
    // A 300 Hz tone survives the averaging almost whole.
    const peak = Math.max(...Array.from(out).map(Math.abs));
    expect(peak).toBeGreaterThan(0.95);
  });

  it("averages away a tone above the new Nyquist instead of folding it back", () => {
    // 12 kHz at 48 kHz is exactly four samples per period: averaging three at
    // a time leaves at most a third of it, where dropping samples would keep it whole.
    const out = resample(tone(48_000, 1, 12_000), 48_000, 16_000);
    const peak = Math.max(...Array.from(out).map(Math.abs));
    expect(peak).toBeLessThan(0.4);
  });

  it("upsamples by linear interpolation", () => {
    expect(Array.from(resample(new Float32Array([0, 1, 0, -1]), 8_000, 16_000))).toEqual([0, 0.5, 1, 0.5, 0, -0.5, -1, -1]);
  });

  it("returns the samples as they are at the same rate", () => {
    const s = new Float32Array([0.25]);
    expect(resample(s, 16_000, 16_000)).toBe(s);
  });
});
