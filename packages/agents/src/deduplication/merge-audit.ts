import type { Entity } from "@magyarsportonline/db";
import { toDateBucket } from "./date-bucket";
import { matchPrimaryEntity, type MatchedEntity } from "./entity-matcher";

/**
 * Merge-justification réteg (2026-07-29, a felhasználó explicit kérésére) —
 * a bizonyító riport ne csak azt igazolja, hogy egy Storyban BBC és Sky is
 * szerepel, hanem azt is, hogy TÉNYLEG ugyanarról az eseményről szólnak.
 *
 * FONTOS ŐSZINTESÉG: a rendszer (docs/adr/0005-mvp-end-to-end-scope-cuts.md
 * döntés 2-3) NEM számol valódi, valószínűségi "összefésülési confidence"-t
 * — a Story Merge Agent kizárólag egy DETERMINISZTIKUS fingerprint-egyezésen
 * (`category` + `primaryEntityId` + napi `dateBucket`, lásd deduplication/
 * index.ts) dönt: vagy pontosan egyezik, vagy nem. Ez a modul nem talál ki
 * egy hamis numerikus pontszámot — ehelyett ÚJRASZÁMOLJA (ugyanazokkal a
 * determinisztikus függvényekkel, amiket az ingest is használt) minden
 * hozzájáruló cikkre a párosítás alapját (melyik entitás, melyik nap), hogy
 * ez a tényleges bizonyíték kerüljön a riportba — a "tényleg ugyanarról szól-e"
 * szemantikai kérdést pedig a riportot összeállító embernek/agentnek kell
 * megválaszolnia a szöveg elolvasásával, nem ez a modul állítja.
 */

export interface ArticleForMergeAudit {
  sourceName: string;
  sourceUrl: string;
  titleOriginal: string;
  bodyOriginal: string;
  publishedAtSource: Date | null;
  ingestedAt: Date;
}

export interface MergeAuditArticleResult {
  sourceName: string;
  sourceUrl: string;
  titleOriginal: string;
  publishedAtSource: string | null;
  matchedEntity: MatchedEntity | null;
  dateBucket: string;
}

export interface MergeAuditResult {
  articles: MergeAuditArticleResult[];
  /** Minden cikk ugyanazt az elsődleges entitást illesztette-e (ez az egyik fingerprint-komponens). */
  agreesOnEntity: boolean;
  /** Minden cikk ugyanabba a napi (UTC) blokkba esik-e (a másik fingerprint-komponens). */
  agreesOnDateBucket: boolean;
  sharedEntity: MatchedEntity | null;
  sharedDateBucket: string | null;
  explanationHu: string;
}

/**
 * Újraszámolja MINDEN hozzájáruló cikkre a fingerprint alapját (elsődleges
 * entitás + napi blokk) a ténylegesen ingest-időben használt függvényekkel
 * (`matchPrimaryEntity`, `toDateBucket`), és emberi nyelvű indoklást ad,
 * hogy a rendszer miért sorolta ugyanabba a Storyba a cikkeket.
 *
 * Ha a mostani entitás-tábla időközben változott (pl. új aliast adtak
 * hozzá) az ingest óta, ELVILEG előfordulhat, hogy az újraszámolt eredmény
 * eltér attól, ami ingestkor ténylegesen párosított — ezt a függvény nem
 * rejti el, hanem az `agreesOnEntity`/`agreesOnDateBucket` false lesz és az
 * `explanationHu` erre figyelmeztet.
 */
export function auditStoryMerge(
  articles: ArticleForMergeAudit[],
  entities: Entity[],
): MergeAuditResult {
  const perArticle: MergeAuditArticleResult[] = articles.map((article) => ({
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    titleOriginal: article.titleOriginal,
    publishedAtSource: article.publishedAtSource?.toISOString() ?? null,
    matchedEntity: matchPrimaryEntity(`${article.titleOriginal} ${article.bodyOriginal}`, entities),
    dateBucket: toDateBucket(article.publishedAtSource ?? article.ingestedAt),
  }));

  const entityIds = new Set(perArticle.map((a) => a.matchedEntity?.entityId ?? null));
  const dateBuckets = new Set(perArticle.map((a) => a.dateBucket));

  const agreesOnEntity = entityIds.size === 1 && !entityIds.has(null);
  const agreesOnDateBucket = dateBuckets.size === 1;
  const sharedEntity = agreesOnEntity ? (perArticle[0]?.matchedEntity ?? null) : null;
  const sharedDateBucket = agreesOnDateBucket ? (perArticle[0]?.dateBucket ?? null) : null;

  let explanationHu: string;
  if (agreesOnEntity && agreesOnDateBucket && sharedEntity) {
    explanationHu =
      `Mind a(z) ${articles.length} cikk ugyanazt az elsődleges entitást ` +
      `("${sharedEntity.nameCanonical}", típus: ${sharedEntity.type}) és ugyanazt a napi ` +
      `(UTC) blokkot ("${sharedDateBucket}") illesztette — a rendszer ez alapján, ` +
      `egy DETERMINISZTIKUS fingerprint-egyezéssel (nem valószínűségi pontszámmal) ` +
      `sorolta ugyanabba a Storyba a cikkeket.`;
  } else {
    explanationHu =
      `FIGYELEM: a fingerprint-alap újraszámolása a jelenlegi entitás-táblával nem ` +
      `egyezik meg minden hozzájáruló cikkre — ez azt jelezheti, hogy az entitás-lista ` +
      `változott az ingest óta, vagy a párosítás alapja bizonytalan. ` +
      `${agreesOnEntity ? "" : "Nem egyezik az elsődleges entitás. "}` +
      `${agreesOnDateBucket ? "" : "Nem egyezik a napi blokk. "}`.trim();
  }

  return {
    articles: perArticle,
    agreesOnEntity,
    agreesOnDateBucket,
    sharedEntity,
    sharedDateBucket,
    explanationHu,
  };
}
