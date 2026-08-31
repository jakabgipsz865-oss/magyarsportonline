import type { Fact } from "@magyarsportonline/db";

/** The Fact shape the Writer/self-check LLM calls actually see — the agent contract's "never raw source text" boundary. */
export interface WriterFact {
  factType: string;
  claimEn?: string;
  evidenceOriginal?: string;
  subject?: string;
  predicate?: string;
  normalizedValue?: string | null;
  eventTimeIso?: string | null;
  sourcePublishedAt?: string | null;
  /** Test/legacy compatibility only; production Fact Verification never writes or reads it as canonical input. */
  detailHu?: string;
  quoteOriginal: string | null;
  quoteSpeaker: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Reads the source-grounded English Fact contract persisted by Fact Verification. */
export function toWriterFact(fact: Fact): WriterFact {
  const payload = fact.payload;
  const value = (key: string) =>
    typeof payload === "object" && payload !== null && key in payload
      ? stringOrNull((payload as Record<string, unknown>)[key])
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
    claimEn: value("claim_en") ?? "",
    evidenceOriginal: value("evidence_original") ?? "",
    subject: value("subject") ?? "",
    predicate: value("predicate") ?? "",
    normalizedValue: value("normalized_value"),
    eventTimeIso: value("event_time_iso"),
    sourcePublishedAt: value("source_published_at"),
    quoteOriginal,
    quoteSpeaker,
  };
}
