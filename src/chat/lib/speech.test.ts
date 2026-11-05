import { describe, expect, it } from "vitest";
import { answerText, pickSpeechFormat, speechLanguage, splitForSpeech } from "./speech";
import type { MessagePart } from "./eventReducer";

const para = (n: number, word = "word") => Array.from({ length: n }, () => word).join(" ") + ".";

describe("answerText", () => {
  it("joins the text parts and skips thinking, tool and notice parts", () => {
    const parts: MessagePart[] = [
      { type: "thinking", text: "let me think" },
      { type: "text", text: "First." },
      { type: "notice", level: "info", text: "Switched model" },
      { type: "tool", call: { id: "t1", name: "Search", input: {}, result: "found it" } },
      { type: "text", text: "Second.\n" },
    ];
    expect(answerText(parts)).toBe("First.\n\nSecond.");
  });
});

describe("splitForSpeech", () => {
  it("packs whole paragraphs into one piece while they fit", () => {
    expect(splitForSpeech("One.\n\nTwo.\n\nThree.", 800)).toEqual(["One.\n\nTwo.\n\nThree."]);
  });

  it("splits at paragraph boundaries under the piece limit", () => {
    const a = para(30); // 150 chars
    const b = para(30);
    const c = para(30);
    const pieces = splitForSpeech([a, b, c].join("\n\n"), 320);
    expect(pieces).toEqual([`${a}\n\n${b}`, c]);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(320);
  });

  it("cuts an over-long paragraph at a sentence end", () => {
    const s1 = para(20, "alpha"); // 120 chars
    const s2 = para(20, "beta");
    const s3 = para(20, "gamma");
    const pieces = splitForSpeech(`${s1} ${s2} ${s3}`, 260);
    expect(pieces).toEqual([`${s1} ${s2}`, s3]);
  });

  it("cuts a paragraph with no sentence end at a space, never inside a word", () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    const pieces = splitForSpeech(words, 50);
    expect(pieces.join(" ")).toBe(words);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(50);
      expect(p.split(" ").every((w) => /^w\d+$/.test(w))).toBe(true);
    }
  });

  it("never splits inside a code fence, blank lines included", () => {
    const code = "```ts\nconst a = 1;\n\nconst b = 2;\n" + "x".repeat(200) + "\n```";
    const pieces = splitForSpeech(`Before.\n\n${code}\n\nAfter.`, 100);
    expect(pieces).toContain(code);
    expect(pieces[0]).toBe("Before.");
    expect(pieces[pieces.length - 1]).toBe("After.");
  });

  it("drops blocks with nothing to say", () => {
    expect(splitForSpeech("Intro.\n\n---\n\n***\n\nOutro.")).toEqual(["Intro.\n\nOutro."]);
    expect(splitForSpeech("---")).toEqual([]);
    expect(splitForSpeech("")).toEqual([]);
  });

  it("keeps Ukrainian text and its punctuation intact", () => {
    const uk = "Привіт! Це перевірка голосу… Сьогодні 4 листопада.";
    expect(splitForSpeech(uk)).toEqual([uk]);
  });
});

describe("pickSpeechFormat", () => {
  const plays = (map: Record<string, string>) => (mime: string) => map[mime] ?? "";

  it("picks the encoded format only when the server lists it and the browser plays it", () => {
    expect(pickSpeechFormat(["wav", "mp3"], plays({ "audio/mpeg": "maybe" }))).toBe("mp3");
    expect(pickSpeechFormat(["wav", "mp3"], plays({}))).toBe("wav");
    expect(pickSpeechFormat(["wav", "ogg"], plays({ 'audio/ogg; codecs="opus"': "probably" }))).toBe("ogg");
    expect(pickSpeechFormat(["wav", "ogg"], plays({ 'audio/ogg; codecs="opus"': "maybe" }))).toBe("wav");
  });

  it("falls back to wav when the list holds only wav, or nothing", () => {
    const all = plays({ "audio/mpeg": "probably", 'audio/ogg; codecs="opus"': "probably" });
    expect(pickSpeechFormat(["wav"], all)).toBe("wav");
    expect(pickSpeechFormat(undefined, all)).toBe("wav");
  });
});

describe("speechLanguage", () => {
  const ukEn = { uk: {}, en: {} };

  it("names en for a mostly Latin piece when the deployment speaks English", () => {
    expect(speechLanguage("Leaves change colour in autumn.", ukEn)).toBe("en");
    expect(speechLanguage("The capital is Київ, on the Dnipro river.", ukEn)).toBe("en");
  });

  it("leaves a mostly Cyrillic piece to loomcycle's own detection", () => {
    expect(speechLanguage("Привіт, це перевірка голосу.", ukEn)).toBeUndefined();
    expect(speechLanguage("Ми використовуємо React і TypeScript у проєкті.", ukEn)).toBeUndefined();
  });

  it("names nothing when English is not configured, or there are no letters", () => {
    expect(speechLanguage("Leaves change colour.", { uk: {} })).toBeUndefined();
    expect(speechLanguage("Leaves change colour.", undefined)).toBeUndefined();
    expect(speechLanguage("12 + 30 = 42", ukEn)).toBeUndefined();
  });
});
