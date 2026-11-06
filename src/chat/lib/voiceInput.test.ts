import { describe, expect, it } from "vitest";
import type { TranscriptionDirectionInfo } from "@loomcycle/client";
import {
  CLIENT_MAX_SECONDS,
  canSendRecording,
  insertTranscript,
  languageName,
  recordingLimitSeconds,
  typeAccepted,
  voiceLanguage,
  voiceLanguages,
} from "./voiceInput";

const info = (over: Partial<TranscriptionDirectionInfo> = {}): TranscriptionDirectionInfo => ({ enabled: true, ...over });

describe("recordingLimitSeconds", () => {
  it("stops at the smallest of the client default, max_seconds_per_request and the upload size as WAV", () => {
    expect(recordingLimitSeconds(info())).toBe(CLIENT_MAX_SECONDS);
    expect(recordingLimitSeconds(info({ max_seconds_per_request: 120 }))).toBe(120);
    // 16 MiB of 16 kHz 16-bit mono WAV is 524 s, above the 300 s default.
    expect(recordingLimitSeconds(info({ max_upload_bytes: 16 * 1024 * 1024 }))).toBe(CLIENT_MAX_SECONDS);
    // 2 MiB holds 65 s.
    expect(recordingLimitSeconds(info({ max_upload_bytes: 2 * 1024 * 1024, max_seconds_per_request: 18_000 }))).toBe(65);
  });
});

describe("typeAccepted", () => {
  it("matches accepts entries as patterns, audio/* included, ignoring parameters", () => {
    expect(typeAccepted(["audio/wav", "audio/webm"], "audio/webm;codecs=opus")).toBe(true);
    expect(typeAccepted(["audio/wav", "audio/*", "video/*"], "audio/mp4")).toBe(true);
    expect(typeAccepted(["audio/wav"], "audio/mp4")).toBe(false);
    expect(typeAccepted(["audio/*"], "video/webm")).toBe(false);
    expect(typeAccepted(["audio/wav"], "")).toBe(false);
    expect(typeAccepted(undefined, "audio/wav")).toBe(false);
  });
});

describe("canSendRecording", () => {
  const webm = { type: "audio/webm;codecs=opus", size: 300_000 };

  it("sends the recorder's own file when the server takes its type and it fits", () => {
    expect(canSendRecording(info({ accepts: ["audio/wav", "audio/webm"], max_upload_bytes: 16_777_216, whole_file_max_bytes: 26_214_400 }), webm)).toBe(true);
  });

  it("refuses the recorder blob above whole_file_max_bytes or the upload limit, or of a type not taken", () => {
    expect(canSendRecording(info({ accepts: ["audio/webm"], whole_file_max_bytes: 200_000 }), webm)).toBe(false);
    expect(canSendRecording(info({ accepts: ["audio/webm"], max_upload_bytes: 200_000 }), webm)).toBe(false);
    expect(canSendRecording(info({ accepts: ["audio/wav"] }), webm)).toBe(false);
  });
});

describe("voiceLanguages", () => {
  it("offers the server's default first, then the languages it speaks, then the host's, once each", () => {
    const speech = { enabled: true, languages: { en: { voices: [], default_voice: "" }, uk: { voices: [], default_voice: "" } } };
    expect(voiceLanguages(info({ default_language: "uk" }), speech, "de")).toEqual(["uk", "en", "de"]);
    expect(voiceLanguages(info({ default_language: "uk" }), null)).toEqual(["uk"]);
    expect(voiceLanguages(info(), null)).toEqual([]);
  });

  it("offers exactly the operator's list, in its order, when the server publishes one", () => {
    const speech = { enabled: true, languages: { de: { voices: [], default_voice: "" } } };
    const listed = info({ default_language: "uk", languages: ["uk", "ru", "en"] });
    expect(voiceLanguages(listed, speech, "fr")).toEqual(["uk", "ru", "en"]);
  });
});

describe("voiceLanguage with the operator's list", () => {
  it("keeps to the list: a stored pick or host language off it gives way to the server's default", () => {
    const options = ["uk", "ru", "en"];
    expect(voiceLanguage(options, "de", "fr", "uk", ["de-DE"])).toBe("uk");
    expect(voiceLanguage(options, "ru", undefined, "uk", [])).toBe("ru");
  });
});

describe("languageName", () => {
  it("names a language in itself, capitalised", () => {
    expect(languageName("uk")).toBe("Українська");
    expect(languageName("ru")).toBe("Русский");
    expect(languageName("en")).toBe("English");
  });

  it("falls back to the code", () => {
    expect(languageName("not-a-code!")).toBe("not-a-code!");
  });
});

describe("voiceLanguage", () => {
  const options = ["uk", "en"];

  it("prefers the conversation's pick, then the host's, then the server's default", () => {
    expect(voiceLanguage(options, "en", "uk", "uk", [])).toBe("en");
    expect(voiceLanguage(options, undefined, "en", "uk", [])).toBe("en");
    expect(voiceLanguage(options, undefined, undefined, "uk", ["en-US"])).toBe("uk");
  });

  it("falls back to the first browser language on offer, and else to none", () => {
    expect(voiceLanguage(options, undefined, undefined, undefined, ["de-DE", "en-GB"])).toBe("en");
    expect(voiceLanguage(options, "fr", undefined, undefined, ["de"])).toBeUndefined();
  });
});

describe("insertTranscript", () => {
  it("inserts at the caret with a space on either side where it would run into a word", () => {
    expect(insertTranscript("Hello world", 5, 5, "big")).toEqual({ text: "Hello big world", caret: 9 });
    expect(insertTranscript("Hello", 5, 5, "there")).toEqual({ text: "Hello there", caret: 11 });
    expect(insertTranscript("", 0, 0, "Привіт")).toEqual({ text: "Привіт", caret: 6 });
    expect(insertTranscript("a \n b", 2, 2, "x")).toEqual({ text: "a x\n b", caret: 3 });
  });

  it("replaces a selection", () => {
    expect(insertTranscript("one two three", 4, 7, "2")).toEqual({ text: "one 2 three", caret: 5 });
  });
});
