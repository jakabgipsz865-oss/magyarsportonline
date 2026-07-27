import type { Fact } from "@magyarsportonline/db";

/** The Fact shape the Writer/self-check LLM calls actually see — the agent contract's "never raw source text" boundary. */
export interface WriterFact {
  factType: string;
  detailHu: string;
  quoteOriginal: string | null;
  quoteSpeaker: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Reads back the payload shape the Fact Verification Agent writes (extraction.ts's `{detail_hu, quote_original, quote_speaker}`). */
export function toWriterFact(fact: Fact): WriterFact {
  const payload = fact.payload;
  const detailHu =
    typeof payload === "object" && payload !== null && "detail_hu" in payload
      ? stringOrNull((payload as { detail_hu: unknown }).detail_hu)
      : null;
  const quoteOriginal =
    typeof payload === "object" && payload !== null && "quote_original" in payload
      ? stringOrNull((payload as { quote_original: unknown }).quote_original)
      : null;
  const quoteSpeaker =
    typeof payload === "object" && payload !== null && "quote_speaker" in payload
      ? stringOrNull((payload as { quote_speaker: unknown }).quote_speaker)
      : null;

  return {
    factType: fact.factType,
    detailHu: detailHu ?? "",
    quoteOriginal,
    quoteSpeaker,
  };
}
