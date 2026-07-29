import { describe, expect, it } from "vitest";
import { extractEntityMentions } from "./entity-mentions";
import type { Entity } from "@magyarsportonline/db";
import { inferSportFromUrl } from "./sport";
import { toDateBucket } from "./date-bucket";
import {
  decideStoryMatch,
  scoreStoryMatch,
  type ArticleMatchInput,
  type CandidateStoryMatchInput,
} from "./story-match";

function entity(overrides: Partial<Entity>): Entity {
  return {
    id: "id",
    type: "team",
    nameCanonical: "name",
    nameHu: "name",
    aliases: [],
    externalRef: null,
    ...overrides,
  };
}

const PREMIER_LEAGUE = entity({
  id: "pl",
  type: "competition",
  nameCanonical: "Premier League",
  aliases: [],
});

function article(
  mentions: ArticleMatchInput["mentions"],
  sport: string | null,
  dateBucket: string,
): ArticleMatchInput {
  return { mentions, sport, dateBucket };
}

function candidate(
  storyId: string,
  entities: CandidateStoryMatchInput["entities"],
  sport: string | null,
  dateBucket: string,
): CandidateStoryMatchInput {
  return { storyId, entities, sport, dateBucket };
}

describe("scoreStoryMatch — rule 1+2: competition-only match is never sufficient", () => {
  it("never sets hasSpecificSharedEntity when only a generic entity is shared", () => {
    const art = article(
      [
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          location: "title",
        },
      ],
      "football",
      "2026-07-29",
    );
    const cand = candidate(
      "story-1",
      [
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          role: "mentioned",
        },
      ],
      "football",
      "2026-07-29",
    );

    const result = scoreStoryMatch(art, cand);

    expect(result.hasSpecificSharedEntity).toBe(false);
    // Even with a generic match plus same-day corroboration, score stays well under the auto-merge threshold.
    expect(result.score).toBeLessThan(65);
  });

  it("decideStoryMatch never returns auto_merge for a generic-only match, regardless of score", () => {
    const art = article(
      [
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          location: "title",
        },
      ],
      "football",
      "2026-07-29",
    );
    const cand = candidate(
      "story-1",
      [
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          role: "mentioned",
        },
      ],
      "football",
      "2026-07-29",
    );

    const decision = decideStoryMatch(art, [cand]);

    expect(decision.kind).not.toBe("auto_merge");
    expect(decision.kind).toBe("auto_new_story");
  });
});

describe("scoreStoryMatch — rule 5: different sports never merge", () => {
  it("forces score 0 and no shared entity when sports are known and differ, even with a shared specific entity", () => {
    const art = article(
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          location: "title",
        },
      ],
      "darts",
      "2026-07-29",
    );
    const cand = candidate(
      "story-1",
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          role: "subject",
        },
      ],
      "football",
      "2026-07-29",
    );

    const result = scoreStoryMatch(art, cand);

    expect(result.sportMismatch).toBe(true);
    expect(result.score).toBe(0);
    expect(result.hasSpecificSharedEntity).toBe(false);
  });

  it("does not block a match when either side's sport is unknown (null)", () => {
    const art = article(
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          location: "title",
        },
      ],
      null,
      "2026-07-29",
    );
    const cand = candidate(
      "story-1",
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          role: "subject",
        },
      ],
      "football",
      "2026-07-29",
    );

    const result = scoreStoryMatch(art, cand);

    expect(result.sportMismatch).toBe(false);
    expect(result.hasSpecificSharedEntity).toBe(true);
  });
});

describe("scoreStoryMatch — specific entity requirement drives auto_merge", () => {
  it("auto_merges on one shared specific entity plus a same-day match", () => {
    const art = article(
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          location: "title",
        },
      ],
      "football",
      "2026-07-29",
    );
    const cand = candidate(
      "story-1",
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          role: "subject",
        },
      ],
      "football",
      "2026-07-29",
    );

    const decision = decideStoryMatch(art, [cand]);

    expect(decision.kind).toBe("auto_merge");
    expect(decision.candidateStoryId).toBe("story-1");
  });

  it("needs_review for one shared specific entity with no other corroboration (different day, no generic overlap)", () => {
    const art = article(
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          location: "title",
        },
      ],
      "football",
      "2026-07-29",
    );
    const cand = candidate(
      "story-1",
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          role: "subject",
        },
      ],
      "football",
      "2026-07-10",
    );

    const decision = decideStoryMatch(art, [cand]);

    expect(decision.kind).toBe("needs_review");
    expect(decision.candidateStoryId).toBe("story-1");
  });

  it("auto_merges readily on two shared specific entities (e.g. same match: both teams)", () => {
    const art = article(
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          location: "title",
        },
        {
          entity: { entityId: "arsenal", type: "team", nameCanonical: "Arsenal FC" },
          location: "title",
        },
      ],
      "football",
      "2026-07-10",
    );
    const cand = candidate(
      "story-1",
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          role: "subject",
        },
        {
          entity: { entityId: "arsenal", type: "team", nameCanonical: "Arsenal FC" },
          role: "opponent",
        },
      ],
      "football",
      "2026-07-20", // far apart in time, no date corroboration at all
    );

    const decision = decideStoryMatch(art, [cand]);

    expect(decision.kind).toBe("auto_merge");
  });

  it("auto_new_story when there are no candidates at all", () => {
    const art = article(
      [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          location: "title",
        },
      ],
      "football",
      "2026-07-29",
    );

    const decision = decideStoryMatch(art, []);

    expect(decision.kind).toBe("auto_new_story");
    expect(decision.candidateStoryId).toBeNull();
  });

  it("records differing specific entities for explainability (rule 7)", () => {
    const art = article(
      [
        {
          entity: { entityId: "chelsea", type: "team", nameCanonical: "Chelsea FC" },
          location: "title",
        },
      ],
      "football",
      "2026-07-29",
    );
    const cand = candidate(
      "story-1",
      [
        {
          entity: { entityId: "arsenal", type: "team", nameCanonical: "Arsenal FC" },
          role: "subject",
        },
      ],
      "football",
      "2026-07-29",
    );

    const result = scoreStoryMatch(art, cand);

    expect(result.hasSpecificSharedEntity).toBe(false);
    expect(result.differingEntities).toEqual(
      expect.arrayContaining([
        { entityId: "chelsea", type: "team", nameCanonical: "Chelsea FC" },
        { entityId: "arsenal", type: "team", nameCanonical: "Arsenal FC" },
      ]),
    );
  });
});

/**
 * Regression test for the real 2026-07-29 production false-merge
 * (docs/open-decisions.md #12 follow-up): 16 articles — darts, golf,
 * cricket, horse racing, F1, tennis, boxing Sky Sports articles plus a BBC
 * "Who am I? Guess Premier League star" quiz — were all merged into one
 * Story purely because every one of them contained the substring "Premier
 * League" somewhere in scraped body text, and all arrived the same UTC
 * day. Reconstructs that exact scenario end-to-end through
 * extractEntityMentions + inferSportFromUrl + decideStoryMatch and asserts
 * NONE of the unrelated articles merge with each other or with the BBC quiz.
 */
describe("regression: the real 16-article Premier League false-merge must not recur", () => {
  const boilerplateCta =
    "Watch Premier League and more with NOW - contract free\n\nStream darts, cricket, golf and more with NOW.";

  const dartsArticle = {
    titleOriginal:
      "Darts Players Championship 25: Henry Coates wins maiden tournament as Gian van Veen, Michael van Gerwen bow out early",
    subtitleOriginal: null,
    bodyOriginal: `Henry Coates sensationally won his maiden title at Players Championship 25 at Hildesheim in Germany.\n\n${boilerplateCta}`,
    sourceUrl:
      "https://www.skysports.com/darts/news/12040/13567883/darts-players-championship-25-henry-coates-wins",
  };
  const golfArticle = {
    titleOriginal: "Solheim Cup 2026: Who needs big week at AIG Women's Open to qualify?",
    subtitleOriginal: null,
    bodyOriginal: `The race to feature for Team Europe in the Solheim Cup reaches a climax this week.\n\n${boilerplateCta}`,
    sourceUrl:
      "https://www.skysports.com/golf/news/12040/13567939/solheim-cup-2026-aig-womens-open",
  };
  const cricketArticle = {
    titleOriginal: "The Hundred: Smriti Mandhana magic fires Manchester Super Giants to victory",
    subtitleOriginal: null,
    bodyOriginal: `Smriti Mandhana dazzled with an imperious 88no.\n\n${boilerplateCta}`,
    sourceUrl: "https://www.skysports.com/cricket/news/12040/13567867/the-hundred-smriti-mandhana",
  };
  const bbcQuizArticle = {
    titleOriginal: "Who am I? Guess Premier League star No 9",
    subtitleOriginal: null,
    bodyOriginal: "A guessing game about a Premier League player.",
    sourceUrl: "https://www.bbc.co.uk/sport/football/articles/c5ydrlg3rjpo",
  };

  const entities: Entity[] = [
    PREMIER_LEAGUE,
    entity({ id: "coates", nameCanonical: "Henry Coates", type: "player", aliases: [] }),
  ];

  function toMatchInput(article: {
    titleOriginal: string;
    subtitleOriginal: string | null;
    bodyOriginal: string;
    sourceUrl: string;
  }): ArticleMatchInput {
    return {
      mentions: extractEntityMentions(article, entities),
      sport: inferSportFromUrl(article.sourceUrl),
      dateBucket: toDateBucket(new Date("2026-07-29T06:00:00.000Z")),
    };
  }

  it("the darts article shares no specific entity with the golf/cricket/BBC-quiz articles, only the generic Premier League entity — never auto-merges", () => {
    const darts = toMatchInput(dartsArticle);
    const golfAsCandidate: CandidateStoryMatchInput = {
      storyId: "story-golf",
      entities: extractEntityMentions(golfArticle, entities).map((m) => ({
        entity: m.entity,
        role: "subject" as const,
      })),
      sport: inferSportFromUrl(golfArticle.sourceUrl),
      dateBucket: toDateBucket(new Date("2026-07-29T06:00:00.000Z")),
    };
    const cricketAsCandidate: CandidateStoryMatchInput = {
      storyId: "story-cricket",
      entities: extractEntityMentions(cricketArticle, entities).map((m) => ({
        entity: m.entity,
        role: "subject" as const,
      })),
      sport: inferSportFromUrl(cricketArticle.sourceUrl),
      dateBucket: toDateBucket(new Date("2026-07-29T06:00:00.000Z")),
    };
    const bbcQuizAsCandidate: CandidateStoryMatchInput = {
      storyId: "story-bbc-quiz",
      entities: extractEntityMentions(bbcQuizArticle, entities).map((m) => ({
        entity: m.entity,
        role: "subject" as const,
      })),
      sport: inferSportFromUrl(bbcQuizArticle.sourceUrl),
      dateBucket: toDateBucket(new Date("2026-07-29T06:00:00.000Z")),
    };

    // The darts article legitimately mentions its own specific player
    // ("Henry Coates") in its title -- that's correct, real extraction, not
    // a bug. What matters is that "Henry Coates" is NOT shared with any of
    // the other (unrelated) articles, and none of them mention "Premier
    // League" outside the stripped boilerplate CTA at the end of the body.
    expect(darts.mentions).toEqual([
      {
        entity: { entityId: "coates", type: "player", nameCanonical: "Henry Coates" },
        location: "title",
      },
    ]);
    expect(golfAsCandidate.entities).toEqual([]);
    expect(cricketAsCandidate.entities).toEqual([]);
    // The BBC quiz DOES mention "Premier League" in its own title -- that's
    // a real, legitimate generic-entity mention, just never sufficient alone.
    expect(bbcQuizAsCandidate.entities).toEqual([
      {
        entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
        role: "subject",
      },
    ]);

    const decision = decideStoryMatch(darts, [
      golfAsCandidate,
      cricketAsCandidate,
      bbcQuizAsCandidate,
    ]);

    // No specific entity anywhere -> always a fresh Story, never a merge.
    expect(decision.kind).toBe("auto_new_story");
    expect(decision.candidateStoryId).toBeNull();
  });

  it("even if a candidate lookup naively matched on the generic Premier League entity, decideStoryMatch would still refuse to auto_merge", () => {
    const bbcQuiz = toMatchInput(bbcQuizArticle);
    const anotherBbcQuizStory: CandidateStoryMatchInput = {
      storyId: "story-another-quiz",
      entities: [
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          role: "subject",
        },
      ],
      sport: "football",
      dateBucket: toDateBucket(new Date("2026-07-29T06:00:00.000Z")),
    };

    const decision = decideStoryMatch(bbcQuiz, [anotherBbcQuizStory]);

    expect(decision.kind).toBe("auto_new_story");
  });
});
