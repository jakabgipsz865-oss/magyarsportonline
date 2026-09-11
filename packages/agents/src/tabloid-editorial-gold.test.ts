import { describe, expect, it } from "vitest";
import type { TabloidSourceMode } from "@magyarsportonline/shared";
import { isFootballTabloid } from "./tabloid";
import gold from "./tabloid-editorial-gold.json";
describe("explicit user editorial gold set", () => {
  for (const mode of ["DIRECT_GOSSIP", "BROAD_TABLOID_FOOTBALL"] as TabloidSourceMode[]) {
    it.each(gold)(`${mode}: $id`, (item) => {
      expect(isFootballTabloid(item.title, item.content, item.footballFeed, mode)).toBe(
        item.expected,
      );
    });
  }
});
