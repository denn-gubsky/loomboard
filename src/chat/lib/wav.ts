/** What voice input uploads: 16 kHz mono 16-bit PCM WAV (RFC FX D3). It is
 *  what loomcycle's own media helper makes from any recording, so it needs no
 *  ffmpeg on the server; the runtime cuts a WAV of any length itself and
 *  measures it exactly from its samples. */
export const WAV_RATE = 16_000;
/** 16-bit mono at WAV_RATE. */
export const WAV_BYTES_PER_SECOND = WAV_RATE * 2;
const HEADER_BYTES = 44;

/** Average the channels into one. Pure. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (const c of channels) for (let i = 0; i < length; i++) out[i] += c[i] / channels.length;
  return out;
}

/** Resample to `to` Hz. Down: each output sample is the average of the input
 *  span it covers (a box filter, enough against aliasing for speech). Up:
 *  linear interpolation. Pure. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = i * ratio;
      const end = start + ratio;
      let sum = 0;
      for (let j = Math.floor(start); j < Math.ceil(end) && j < samples.length; j++) {
        sum += samples[j] * (Math.min(j + 1, end) - Math.max(j, start));
      }
      out[i] = sum / ratio;
    }
  } else {
    for (let i = 0; i < length; i++) {
      const at = i * ratio;
      const j = Math.floor(at);
      const next = samples[Math.min(j + 1, samples.length - 1)];
      out[i] = samples[j] + (next - samples[j]) * (at - j);
    }
  }
  return out;
}

/** 16-bit mono PCM WAV of `samples` (-1..1, clipped). Pure. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(HEADER_BYTES + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** A browser recording (webm/Opus, mp4/AAC, …) as voice input's WAV. Throws
 *  when the browser cannot decode it; the caller then sends the recording as
 *  it is, if the server takes its type. */
export async function recordingToWav(recording: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await recording.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    const mono = resample(mixToMono(channels), audio.sampleRate, WAV_RATE);
    return new Blob([encodeWav(mono, WAV_RATE) as BlobPart], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}
