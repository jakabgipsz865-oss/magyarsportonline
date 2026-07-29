/**
 * Review-queue triage (2026-07-29, "queue-tisztító és triage réteg"
 * sprint): the review queue had grown to ~300 unsorted Stories, forcing a
 * human to manually inspect every single one. This module sorts every
 * pending Story into exactly one of 4 buckets so a human only ever has to
 * look at genuine editorial judgment calls:
 *
 * - `ready_for_review`: passed every automatic check — a human can approve
 *   quickly without deep scrutiny, but FORCE_REVIEW_MODE still requires an
 *   explicit click (this module never auto-publishes anything).
 * - `auto_repair_required`: a KNOWN, already-automatable defect (English/
 *   quality-gate-flagged content, missing credibility score) — never shown
 *   to a human until the repair has actually been attempted.
 * - `human_decision_required`: a genuine judgment call (source
 *   contradiction, ambiguous Story-merge candidate) — the ONLY category a
 *   human should see by default.
 * - `reject_or_archive`: a confident, mechanical "this shouldn't be here"
 *   call (near-certain duplicate of another Story, off-topic sport
 *   vertical, stale) — never a human decision, never an LLM guess.
 *
 * Deliberately rule-based, no LLM call, same "no invented probabilistic
 * confidence" discipline as publish-gate/rule.ts and merge-audit.ts — every
 * category assignment has a concrete, testable reason.
 */

export type StoryTriageCategory =
  | "ready_for_review"
  | "auto_repair_required"
  | "human_decision_required"
  | "reject_or_archive";

export const STORY_TRIAGE_CATEGORY_LABELS_HU: Record<StoryTriageCategory, string> = {
  ready_for_review: "Kész review-ra",
  auto_repair_required: "Automatikus javítás szükséges",
  human_decision_required: "Emberi döntés szükséges",
  reject_or_archive: "Elutasítandó / archiválandó",
};

export interface StoryTriageResult {
  category: StoryTriageCategory;
  reasonsHu: string[];
}

export interface StoryTriageInput {
  /** `story_versions.is_ai_generated` for the latest version — `false` means the No-LLM passthrough produced this content (never real Hungarian text). */
  isAiGenerated: boolean;
  /** Flattened `QualityIssue.kind` values from the latest version's Content Quality Gate result (hungarian-writer/quality-gate.ts). */
  qualityIssueKinds: string[];
  credibilityScore: number | null;
  hasContradiction: boolean;
  /** A pending (`needs_review`, unresolved) Story-match decision points at this Story as a merge candidate — the scored matcher found a specific shared entity but not enough corroboration to auto-merge. */
  hasAmbiguousMergeDecision: boolean;
  /** This Story is the NEWER side of a pair that scored at/above the live matcher's own auto-merge threshold (story-match.ts AUTO_MERGE_THRESHOLD) against another Story — i.e., the live system would have merged these had it ever compared them directly. */
  isConfidentDuplicate: boolean;
  /** The sport vertical inferred from this Story's own contributing article URLs (`inferSportFromUrl`), when unambiguous — `null` when unknown/mixed. */
  detectedSport: string | null;
  /** Whether ANY known entity (any type, not just specific) was found in this Story's title/lead — a near-zero value is a weak "probably not useful content" signal, not a confident one. */
  hasAnyRecognizedEntity: boolean;
  /** Days since this Story last updated. */
  ageDays: number;
}

/** The site's one actively-curated sport vertical — anything else detected from the source URL is off-topic by construction (see sport.ts's own doc comment on the exact historical bug this targets: darts/golf/cricket articles misfiled under a "Football" source). */
const TARGET_SPORT = "football";

/** A Story sitting this long without being decided on is no longer a fresh news item — stale, not an editorial judgment call. */
const STALE_AGE_DAYS = 14;

export function classifyStoryTriage(input: StoryTriageInput): StoryTriageResult {
  // reject_or_archive — confident, mechanical calls, checked first (never
  // let a genuine defect or judgment call mask an "this doesn't belong here" case).
  if (input.isConfidentDuplicate) {
    return {
      category: "reject_or_archive",
      reasonsHu: [
        "Egy másik, korábbi Story-val a pontos élő párosító-küszöböt elérő pontszámon oszt meg specifikus entitást — gyakorlatilag biztos duplikátum.",
      ],
    };
  }
  if (input.detectedSport !== null && input.detectedSport !== TARGET_SPORT) {
    return {
      category: "reject_or_archive",
      reasonsHu: [
        `A forráscikk URL-je "${input.detectedSport}" sportágat jelez, nem labdarúgást — nem célkategória.`,
      ],
    };
  }
  if (input.ageDays > STALE_AGE_DAYS) {
    return {
      category: "reject_or_archive",
      reasonsHu: [
        `${Math.floor(input.ageDays)} napja nem frissült — túl régi ahhoz, hogy még aktuális hír legyen.`,
      ],
    };
  }

  // auto_repair_required — known, already-automatable defects.
  const repairReasons: string[] = [];
  if (!input.isAiGenerated) {
    repairReasons.push(
      "A szöveg nem valódi AI-fordítás eredménye (No-LLM fallback) — újrafeldolgozás szükséges.",
    );
  }
  if (input.qualityIssueKinds.length > 0) {
    repairReasons.push(
      `Tartalmi minőségi hiba a Content Quality Gate szerint: ${input.qualityIssueKinds.join(", ")}.`,
    );
  }
  if (input.credibilityScore === null) {
    repairReasons.push("Nincs kiszámolt hitelességi pont — újraszámolás szükséges.");
  }
  if (repairReasons.length > 0) {
    return { category: "auto_repair_required", reasonsHu: repairReasons };
  }

  // human_decision_required — genuine editorial judgment calls.
  const humanReasons: string[] = [];
  if (input.hasContradiction) {
    humanReasons.push(
      "A források ellentmondanak egymásnak — nem megerősített állítás, emberi döntés szükséges.",
    );
  }
  if (input.hasAmbiguousMergeDecision) {
    humanReasons.push(
      "A rendszer bizonytalan Story-összevonási jelöltet talált (needs_review) — nem vonta össze automatikusan.",
    );
  }
  if (!input.hasAnyRecognizedEntity) {
    humanReasons.push(
      "Nem található felismerhető csapat/játékos/edző/verseny entitás a címben/lead-ben — bizonytalan, hogy releváns sporttartalom-e.",
    );
  }
  if (humanReasons.length > 0) {
    return { category: "human_decision_required", reasonsHu: humanReasons };
  }

  return {
    category: "ready_for_review",
    reasonsHu: [
      "Minden automatikus ellenőrzésen megfelelt: valódi magyar szöveg, hitelességi pont kiszámolva, nincs ellentmondás vagy bizonytalan összevonás.",
    ],
  };
}
