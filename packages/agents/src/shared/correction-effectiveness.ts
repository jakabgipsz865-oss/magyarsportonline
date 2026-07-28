/**
 * "Mérhető szerkesztői memória" (2026-07-28 sprint) — nem elég betölteni a
 * szerkesztő javításait a promptba, azt is mérni kell, hogy a modell
 * ténylegesen alkalmazta-e őket a KÖVETKEZŐ generálásoknál. Ez a modul két,
 * egymásra épülő, tisztán funkcionális lépés:
 *
 * 1. `evaluateCorrectionApplication` — egyetlen generálás kimenetét veti
 *    össze egyetlen javítással, és eldönti: alkalmazta (✔), részben
 *    alkalmazta (⚠), nem alkalmazta / a hiba újra előfordult (✖), vagy a
 *    javítás ehhez a cikkhez egyáltalán nem volt releváns (null — nincs
 *    mérési esemény, nem számít bele semmilyen arányba).
 * 2. `summarizeCorrectionApplications` — egy javítás összes eddigi mérési
 *    eseményéből (idővel bővülő napló, lásd
 *    packages/db/src/repositories/editorial-correction-application-repository.ts)
 *    épít egy összegzést: hányszor melyik verdikt, mi a legutóbbi, és javult
 *    vagy romlott-e az előzőhöz képest.
 */

import type { EditorialCorrection } from "./editorial-corrections";

export type CorrectionApplicationVerdict = "applied" | "partial" | "not_applied";

export interface CorrectionApplicationResult {
  verdict: CorrectionApplicationVerdict;
  evidence: string;
}

/**
 * `generatedText`: a friss generálás teljes szövege (cím+lead+törzs).
 * `sourceText`: a bemeneti anyag, amiből a generálás készült (angol idézetek
 * a Hungarian Writernél, vagy angol idézetek + az átírás előtti magyar draft
 * az Editorial Rewrite-nál) — csak a `termEn` relevancia-ellenőrzéshez kell.
 *
 * Visszaadja null-t, ha a javítás témája fel sem merült ebben a cikkben (sem
 * a régi, sem az új megfogalmazás nem jelenik meg a kimenetben, és a
 * kifejezés sem szerepel a forrásban) — ez NEM "nem alkalmazta", hanem
 * "nem volt mit alkalmazni", ezért nem kerül be a mérési naplóba.
 */
export function evaluateCorrectionApplication(
  correction: EditorialCorrection,
  generatedText: string,
  sourceText: string,
): CorrectionApplicationResult | null {
  const generated = generatedText.toLowerCase();
  const oldPhrase = correction.currentSentenceHu.trim().toLowerCase();
  const newPhrase = correction.correctedSentenceHu.trim().toLowerCase();
  const hasOld = oldPhrase.length > 0 && generated.includes(oldPhrase);
  const hasNew = newPhrase.length > 0 && newPhrase !== oldPhrase && generated.includes(newPhrase);

  if (hasOld && hasNew) {
    return {
      verdict: "partial",
      evidence: `Mind a korábbi hibás, mind a javított megfogalmazás előfordul a szövegben ("${correction.currentSentenceHu}" és "${correction.correctedSentenceHu}").`,
    };
  }
  if (hasOld) {
    return {
      verdict: "not_applied",
      evidence: `A korábbi hibás megfogalmazás újra előfordult: "${correction.currentSentenceHu}".`,
    };
  }
  if (hasNew) {
    return {
      verdict: "applied",
      evidence: `A javított megfogalmazás megjelent: "${correction.correctedSentenceHu}".`,
    };
  }

  const trigger = correction.termEn?.trim().toLowerCase();
  if (trigger && trigger.length > 0 && sourceText.toLowerCase().includes(trigger)) {
    return {
      verdict: "partial",
      evidence: `A kifejezés ("${correction.termEn}") releváns volt a cikkben, de sem a régi, sem a javított megfogalmazás nem egyezett szó szerint — a modell máshogy fogalmazott.`,
    };
  }

  return null;
}

export interface CorrectionApplicationEvent {
  verdict: CorrectionApplicationVerdict;
  detectedAt: Date;
}

const VERDICT_RANK: Record<CorrectionApplicationVerdict, number> = {
  not_applied: 0,
  partial: 1,
  applied: 2,
};

export type ApplicationTrend = "improved" | "worsened" | "unchanged" | null;

export interface CorrectionApplicationSummary {
  totalCount: number;
  appliedCount: number;
  partialCount: number;
  notAppliedCount: number;
  latestVerdict: CorrectionApplicationVerdict | null;
  /** null, ha kevesebb, mint két mérési esemény van — trendet csak egymást követő eseményekből lehet levezetni. */
  trend: ApplicationTrend;
}

/** Az események sorrendje a hívótól tetszőleges lehet — itt rendezzük időrendbe a trendszámításhoz. */
export function summarizeCorrectionApplications(
  events: CorrectionApplicationEvent[],
): CorrectionApplicationSummary {
  const sorted = [...events].sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());
  const appliedCount = sorted.filter((event) => event.verdict === "applied").length;
  const partialCount = sorted.filter((event) => event.verdict === "partial").length;
  const notAppliedCount = sorted.filter((event) => event.verdict === "not_applied").length;
  const latest = sorted[sorted.length - 1] ?? null;
  const previous = sorted[sorted.length - 2] ?? null;

  let trend: ApplicationTrend = null;
  if (latest && previous) {
    const diff = VERDICT_RANK[latest.verdict] - VERDICT_RANK[previous.verdict];
    trend = diff > 0 ? "improved" : diff < 0 ? "worsened" : "unchanged";
  }

  return {
    totalCount: sorted.length,
    appliedCount,
    partialCount,
    notAppliedCount,
    latestVerdict: latest?.verdict ?? null,
    trend,
  };
}
