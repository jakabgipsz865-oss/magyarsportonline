import type { EditorialCorrectionCategory, EditorialCorrectionInput } from "@magyarsportonline/db";
import { createRepositories, type Repositories } from "./db";
import { getLogger } from "./logger";

export const EDITORIAL_CORRECTION_CATEGORIES: EditorialCorrectionCategory[] = [
  "slang",
  "terminology",
  "literal_translation",
  "style",
  "grammar",
  "fact",
];

export function isEditorialCorrectionCategory(value: string): value is EditorialCorrectionCategory {
  return (EDITORIAL_CORRECTION_CATEGORIES as string[]).includes(value);
}

export type SubmitCorrectionResult = { ok: true } | { ok: false; error: "missing_required_field" };

/**
 * "Tanítható szerkesztői felület" (2026-07-28 sprint,
 * /internal/editorial-ab-review): egy szerkesztő által elfogadott,
 * mondatszintű javítás mentése. Sosem módosít már generált/publikált
 * tartalmat — kizárólag tanítóanyagot ment, amit a Hungarian Writer és az
 * Editorial Rewrite Agent a KÖVETKEZŐ cikkeknél olvas fel (lásd
 * packages/agents/src/shared/editorial-corrections.ts).
 */
export async function submitEditorialCorrection(
  input: EditorialCorrectionInput,
  repos: Repositories = createRepositories(),
): Promise<SubmitCorrectionResult> {
  if (
    input.storyId.length === 0 ||
    input.originalSentenceEn.length === 0 ||
    input.currentSentenceHu.length === 0 ||
    input.correctedSentenceHu.length === 0
  ) {
    return { ok: false, error: "missing_required_field" };
  }

  await repos.editorialCorrectionRepository.create(input);
  getLogger().info(
    { storyId: input.storyId, category: input.category },
    "editorial correction accepted",
  );
  return { ok: true };
}
