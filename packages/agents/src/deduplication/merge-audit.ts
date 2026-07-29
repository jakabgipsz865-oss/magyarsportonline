import type { Entity } from "@magyarsportonline/db";
import { toDateBucket } from "./date-bucket";
import type { MatchedEntity } from "./entity-matcher";
import { extractEntityMentions } from "./entity-mentions";
import { isSpecificEntityType } from "./story-match";

/**
 * Merge-justification réteg (2026-07-29, a felhasználó explicit kérésére) —
 * a bizonyító riport ne csak azt igazolja, hogy egy Storyban BBC és Sky is
 * szerepel, hanem azt is, hogy TÉNYLEG ugyanarról az eseményről szólnak.
 *
 * FONTOS ŐSZINTESÉG: a rendszer (docs/adr/0005-mvp-end-to-end-scope-cuts.md
 * döntés 2-3) NEM számol valódi, valószínűségi "összefésülési confidence"-t
 * — a Story Merge Agent egy SPECIFIKUS (csapat/játékos/edző) entitás
 * TITLE/LEAD-alapú egyezésén dönt (lásd story-match.ts, deduplication/
 * index.ts), sosem a teljes body szövegen. Ez a modul nem talál ki egy hamis
 * numerikus pontszámot — ehelyett ÚJRASZÁMOLJA (ugyanazokkal a
 * determinisztikus függvényekkel, amiket az ingest is használ:
 * `extractEntityMentions` + `isSpecificEntityType`) minden hozzájáruló
 * cikkre a párosítás alapját (melyik SPECIFIKUS entitás, melyik nap), hogy
 * ez a tényleges bizonyíték kerüljön a riportba — a "tényleg ugyanarról szól-e"
 * szemantikai kérdést pedig a riportot összeállító embernek/agentnek kell
 * megválaszolnia a szöveg elolvasásával, nem ez a modul állítja.
 *
 * FONTOS (2026-07-29, "bővítsd a specifikus entitásfelismerést" sprint):
 * korábban ez a modul `matchPrimaryEntity`-t hívta a cikk TELJES (title+body)
 * szövegén, generikus (competition/league/venue) típusokat is elfogadva —
 * pontosan az a hibaosztály, ami a valódi 16-cikkes false-merge-et okozta a
 * ténylegesen élő párosítóban (docs/open-decisions.md #12). A ténylegesen élő
 * párosító ezt már 2026-07-29-én kijavította (PR #49), de ez a KÜLÖN,
 * csak-olvasási diagnosztikai modul lemaradt — a bizonyító riport
 * "elmulasztott összevonás" szakasza emiatt teljesen független, valójában
 * össze NEM tartozó cikkeket (pl. darts, golf, cricket, boksz) csoportosított
 * egybe, mert mindegyikben megtalálta ugyanazt a generikus entitást valahol
 * a teljes törzsszövegben. Most már ugyanazt a title/lead-only,
 * csak-specifikus-entitás logikát használja, mint az élő párosító, hogy a
 * riport saját "elmulasztott merge" szakasza is megbízható legyen.
 */

export interface ArticleForMergeAudit {
  sourceName: string;
  sourceUrl: string;
  titleOriginal: string;
  subtitleOriginal: string | null;
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
  /** Minden cikk ugyanazt a SPECIFIKUS (csapat/játékos/edző) entitást illesztette-e a címében/lead-jében (ez az egyik fingerprint-komponens). */
  agreesOnEntity: boolean;
  /** Minden cikk ugyanabba a napi (UTC) blokkba esik-e (a másik fingerprint-komponens). */
  agreesOnDateBucket: boolean;
  sharedEntity: MatchedEntity | null;
  sharedDateBucket: string | null;
  explanationHu: string;
}

/** Among an article's title/lead entity mentions, the first SPECIFIC (team/player/coach) one — never generic, never from the body. */
function matchSpecificEntity(
  article: Pick<ArticleForMergeAudit, "titleOriginal" | "subtitleOriginal" | "bodyOriginal">,
  entities: Entity[],
): MatchedEntity | null {
  const mentions = extractEntityMentions(article, entities);
  return mentions.find((m) => isSpecificEntityType(m.entity.type))?.entity ?? null;
}

/**
 * Újraszámolja MINDEN hozzájáruló cikkre a fingerprint alapját (specifikus
 * entitás + napi blokk) a ténylegesen ingest-időben használt függvényekkel
 * (`extractEntityMentions` + `isSpecificEntityType`, `toDateBucket`), és
 * emberi nyelvű indoklást ad, hogy a rendszer miért sorolta ugyanabba a
 * Storyba a cikkeket.
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
    matchedEntity: matchSpecificEntity(article, entities),
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
      `Mind a(z) ${articles.length} cikk ugyanazt a SPECIFIKUS (csapat/játékos/edző) ` +
      `entitást ("${sharedEntity.nameCanonical}", típus: ${sharedEntity.type}) illesztette a ` +
      `címében/lead-jében, és ugyanabba a napi (UTC) blokkba ("${sharedDateBucket}") esik — ` +
      `a rendszer ez alapján, egy DETERMINISZTIKUS fingerprint-egyezéssel (nem ` +
      `valószínűségi pontszámmal) sorolta ugyanabba a Storyba a cikkeket.`;
  } else {
    explanationHu =
      `FIGYELEM: a fingerprint-alap újraszámolása a jelenlegi entitás-táblával nem ` +
      `egyezik meg minden hozzájáruló cikkre — ez azt jelezheti, hogy az entitás-lista ` +
      `változott az ingest óta, vagy a párosítás alapja bizonytalan. ` +
      `${agreesOnEntity ? "" : "Nem egyezik a specifikus entitás. "}` +
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
