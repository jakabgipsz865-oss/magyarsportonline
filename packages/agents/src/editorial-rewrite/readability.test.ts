import { describe, expect, it } from "vitest";
import { computeReadability } from "./readability";

describe("computeReadability", () => {
  it("counts words, sentences and paragraphs", () => {
    const text = "Ez egy mondat. Ez egy másik mondat!\n\nEz egy új bekezdés.";
    const result = computeReadability(text);

    expect(result.paragraphCount).toBe(2);
    expect(result.sentenceCount).toBe(3);
    expect(result.wordCount).toBe(11);
  });

  it("reports a shorter average sentence length for choppier text", () => {
    const short = computeReadability("Gól. Győzelem. Vége.");
    const long = computeReadability(
      "A Liverpool a mérkőzés hosszabbításában szerzett góllal, amelyet a csapatkapitány fejelt a kapuba, biztosította be a bajnoki győzelmet.",
    );

    expect(short.avgSentenceLengthWords).toBeLessThan(long.avgSentenceLengthWords);
  });

  it("handles empty input without dividing by zero", () => {
    const result = computeReadability("");
    expect(result.wordCount).toBe(0);
    expect(result.avgSentenceLengthWords).toBe(0);
    expect(result.avgWordLengthChars).toBe(0);
  });
});
