import type { ArticleExtractor } from "../types";
import { bbcSportExtractor } from "./bbc-sport";

/**
 * Named, forrásonkénti extractorok registry-je (2026-07-28-i "Source
 * Fetcher" sprint) — SZÁNDÉKOSAN NEM egy általános web scraper. Minden
 * bejegyzés egy konkrét, ismert HTML-szerkezetű sportforráshoz van kötve.
 *
 * Ebben a sprintben KIZÁRÓLAG a BBC Sport extractor van ténylegesen
 * implementálva és valós cikkel bizonyítva (lásd
 * .github/workflows/bbc-extractor-diagnostic.yml). A további tervezett
 * médiaforrások (Sky Sports, The Guardian, ESPN, Marca, AS, Mundo
 * Deportivo, Gazzetta dello Sport, Corriere dello Sport, Kicker, Sport1,
 * L'Équipe, RMC Sport), az öt liga hivatalos oldalai, a klubok hivatalos
 * híroldalai, a UEFA/FIFA oldalak és a football-data.org adapter külön
 * sprintekben kerülnek ide, mindegyik a saját valódi HTML-szerkezetéhez
 * (vagy API-válaszához) igazított, önálló extractorral/adapterrel — lásd
 * docs/source-registry.md és docs/open-decisions.md a tervezett sorrendért
 * és a forrásonkénti dokumentációért.
 *
 * Egy itt fel nem sorolt (vagy regisztrált, de `supports()`-ban `false`-t
 * adó) domainre az `ArticleFetcher` biztonságosan `null`-t ad vissza — a
 * hívó ilyenkor mindig az RSS-snippetre esik vissza.
 */
export const ARTICLE_EXTRACTORS: ArticleExtractor[] = [bbcSportExtractor];

export { bbcSportExtractor };
