"use server";

import type { EditorialCorrectionRow } from "@magyarsportonline/db";
import { isEditorialCorrectionCategory, submitEditorialCorrection } from "./editorial-corrections";

export interface SaveTeachableCorrectionInput {
  storyId: string;
  category: string;
  termEn: string;
  originalSentenceEn: string;
  currentSentenceHu: string;
  correctedSentenceHu: string;
  note: string;
}

export type SaveTeachableCorrectionResult =
  | { ok: true; correction: EditorialCorrectionRow }
  | { ok: false; error: string };

/**
 * "Gyors tanítási munkafolyamat" (2026-07-28-i sprint) — ugyanazt a
 * `submitEditorialCorrection`-t hívja, mint a részletes nézet
 * `submitCorrectionAction`-je, de SZÁNDÉKOSAN nem hív `revalidatePath`-et:
 * a kliens (FastTrainingWorkbench.tsx) a visszaadott sorral azonnal
 * frissíti a saját állapotát (keresés, hasonlósági javaslatok), így a
 * szerkesztő nem vár egy teljes oldal-újrarenderelést minden egyes mentés
 * után — ez pont a sebesség kedvéért hozott, tudatos kompromisszum. A
 * részletes nézet (cikkenkénti javítás-előzmény, mérési badge-ek) a
 * következő teljes oldalbetöltéskor frissül.
 */
export async function saveTeachableCorrection(
  input: SaveTeachableCorrectionInput,
): Promise<SaveTeachableCorrectionResult> {
  if (!isEditorialCorrectionCategory(input.category)) {
    return { ok: false, error: "invalid_category" };
  }
  if (
    input.storyId.length === 0 ||
    input.originalSentenceEn.trim().length === 0 ||
    input.currentSentenceHu.length === 0 ||
    input.correctedSentenceHu.trim().length === 0
  ) {
    return { ok: false, error: "missing_required_field" };
  }

  const result = await submitEditorialCorrection({
    storyId: input.storyId,
    category: input.category,
    termEn: input.termEn.trim().length > 0 ? input.termEn.trim() : null,
    originalSentenceEn: input.originalSentenceEn.trim(),
    currentSentenceHu: input.currentSentenceHu,
    correctedSentenceHu: input.correctedSentenceHu.trim(),
    note: input.note.trim().length > 0 ? input.note.trim() : null,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, correction: result.correction };
}
