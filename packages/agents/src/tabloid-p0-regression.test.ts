import { describe, it, expect } from "vitest";
import { isFootballTabloid } from "./tabloid";
const regressions = [
  [
    "BILD Horner/F1",
    "Es geht um ein Buch - Neuer Zoff zwischen Horner und Red Bull",
    "Horners Autobiografie erscheint am Todestag von Mateschitz und verärgert Red Bull.",
  ],
  [
    "Tuttosport Koné",
    "Kone, niente esami ma resta in dubbio per Torino-Roma: le condizioni del centrocampista",
    "Il francese esce dal campo per un problema al ginocchio accusato nella sfida di Champions con il Fenerbahce",
  ],
];
describe("Preview P0 regressions", () => {
  it.each(regressions)("%s => REJECT in both source modes", (_, title, body) => {
    for (const mode of ["DIRECT_GOSSIP", "BROAD_TABLOID_FOOTBALL"] as const)
      expect(isFootballTabloid(title!, body!, true, mode)).toBe(false);
  });
  it.each([
    "F1 scandal: Red Bull furious at Christian Horner",
    "Manu Kone injury update leaves Roma fans furious",
    "Manu Kone fitness update before Roma match",
    "Manu Kone: le condizioni del centrocampista dopo il problema al ginocchio",
  ])("sports update remains REJECT: %s", (title) => {
    expect(isFootballTabloid(title, "", true, "DIRECT_GOSSIP")).toBe(false);
  });
  it("primary off-field robbery stays ACCEPT even with an injury", () => {
    expect(
      isFootballTabloid(
        "Donnarumma and girlfriend injured in terrifying robbery",
        "The footballer described the attack on his family.",
        true,
        "BROAD_TABLOID_FOOTBALL",
      ),
    ).toBe(true);
  });
});
