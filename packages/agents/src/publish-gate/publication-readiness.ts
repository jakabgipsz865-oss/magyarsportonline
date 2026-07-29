import type { WriterFact } from "../hungarian-writer/facts";
import {
  assessContentQuality,
  type QualityIssue,
} from "../hungarian-writer/quality-gate";

export type PublicationBlockerKind =
  | "content_quality_failed"
  | "fallback_generation"
  | "self_check_fallback"
  | "fact_check_failed"
  | "missing_credibility"
  | "missing_source"
  | "missing_full_article_source";

export interface PublicationBlocker {
  kind: PublicationBlockerKind;
  qualityIssue?: QualityIssue;
}

export interface PublicationReadinessInput {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  facts: WriterFact[];
  isAiGenerated: boolean;
  factConsistencyScore: number | null;
  selfCheckFallback: boolean;
  credibilityScore: number | null;
  sourceCount: number;
  fullArticleSourceCount: number;
}

export interface PublicationReadinessAssessment {
  passed: boolean;
  blockers: PublicationBlocker[];
  qualityIssues: QualityIssue[];
}

/**
 * The single fail-closed publication invariant. Both the automatic Publish
 * Gate and the human review approval path must run this function against
 * the CURRENT draft; persisted qualityIssues are audit data, never trusted
 * as proof that content edited later is still safe.
 */
export function assessPublicationReadiness(
  input: PublicationReadinessInput,
): PublicationReadinessAssessment {
  const quality = assessContentQuality({
    titleHu: input.titleHu,
    leadHu: input.leadHu,
    bodyHu: input.bodyHu,
    facts: input.facts,
  });
  const minimumLengthIssues: QualityIssue[] = [
    ...(input.titleHu.trim().length < 5
      ? ([{ field: "title", kind: "too_short" }] as const)
      : []),
    ...(input.leadHu.trim().length < 20
      ? ([{ field: "lead", kind: "too_short" }] as const)
      : []),
    ...(input.bodyHu.trim().length < 60
      ? ([{ field: "body", kind: "too_short" }] as const)
      : []),
  ];
  const qualityIssues = [...quality.issues, ...minimumLengthIssues];
  const blockers: PublicationBlocker[] = qualityIssues.map((qualityIssue) => ({
    kind: "content_quality_failed",
    qualityIssue,
  }));

  if (!input.isAiGenerated) {
    blockers.push({ kind: "fallback_generation" });
  }
  if (input.selfCheckFallback) {
    blockers.push({ kind: "self_check_fallback" });
  }
  if (input.factConsistencyScore === null || input.factConsistencyScore < 0.95) {
    blockers.push({ kind: "fact_check_failed" });
  }
  if (input.credibilityScore === null) {
    blockers.push({ kind: "missing_credibility" });
  }
  if (input.sourceCount < 1) {
    blockers.push({ kind: "missing_source" });
  }
  if (input.fullArticleSourceCount < 1) {
    blockers.push({ kind: "missing_full_article_source" });
  }

  return {
    passed: blockers.length === 0,
    blockers,
    qualityIssues,
  };
}
