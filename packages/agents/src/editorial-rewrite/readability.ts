/**
 * Purely mechanical readability signals — no claim to a validated Hungarian
 * Flesch-style formula (none of the standard ones are normed for sports
 * news), just the two measurements every readability model agrees move in
 * the same direction: shorter sentences and shorter words read easier. Used
 * as supporting quantitative evidence alongside the LLM-judge comparison in
 * the A/B test (ab-test.ts) — never as a rewrite-acceptance gate.
 */
export interface ReadabilityMetrics {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  avgSentenceLengthWords: number;
  avgWordLengthChars: number;
  avgParagraphLengthSentences: number;
}

function splitNonEmpty(text: string, pattern: RegExp): string[] {
  return text
    .split(pattern)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function computeReadability(text: string): ReadabilityMetrics {
  const paragraphs = splitNonEmpty(text, /\n\s*\n/);
  const sentences = splitNonEmpty(text, /(?<=[.!?])\s+/);
  const words = splitNonEmpty(text, /\s+/);
  const wordChars = words.map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);

  const wordCount = words.length;
  const sentenceCount = Math.max(sentences.length, 1);
  const paragraphCount = Math.max(paragraphs.length, 1);

  return {
    wordCount,
    sentenceCount,
    paragraphCount,
    avgSentenceLengthWords: wordCount / sentenceCount,
    avgWordLengthChars:
      wordChars.length > 0
        ? wordChars.reduce((sum, word) => sum + word.length, 0) / wordChars.length
        : 0,
    avgParagraphLengthSentences: sentenceCount / paragraphCount,
  };
}
