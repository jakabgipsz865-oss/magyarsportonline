export interface VerifiedAudience {
  source: "verified_existing";
  monthlyPageviews: number | null;
  uniqueVisitorsByDay: number[] | null;
}
/** Qualified reads are deliberately absent from this interface. */
export function monetizationEstimates(data: VerifiedAudience | null) {
  const pv = data?.monthlyPageviews;
  const inventory =
    pv !== null && pv !== undefined && Number.isSafeInteger(pv) && pv >= 0
      ? [1, 2, 3].map((slots) => ({
          slots,
          theoretical: pv * slots,
          sellable: Math.floor(pv * slots * 0.7),
        }))
      : null;
  const days = data?.uniqueVisitorsByDay;
  const average =
    days?.length === 30 && days.every((v) => Number.isSafeInteger(v) && v >= 0)
      ? days.reduce((a, b) => a + b, 0) / 30
      : null;
  return {
    inventory,
    averageDailyUv: average,
    threshold:
      average === null
        ? null
        : average >= 15000
          ? "Professzionális sales"
          : average >= 5000
            ? "Direkt hirdetés"
            : average >= 3000
              ? "Médiakit előkészítés"
              : "Még a belső küszöb alatt",
  };
}
