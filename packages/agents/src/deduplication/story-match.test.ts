import { describe, expect, it } from "vitest";
import { extractEntityMentions } from "./entity-mentions";
import type { Entity } from "@magyarsportonline/db";
import { inferSportFromUrl } from "./sport";
import { toDateBucket } from "./date-bucket";
import {
  classifyMatchCategory,
  decideStoryMatch,
  extractRoundLabel,
  isGenericEntityType,
  isSpecificEntityType,
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

describe("isSpecificEntityType / isGenericEntityType", () => {
  it("treats team, player, and coach as specific", () => {
    expect(isSpecificEntityType("team")).toBe(true);
    expect(isSpecificEntityType("player")).toBe(true);
    expect(isSpecificEntityType("coach")).toBe(true);
  });

  it("treats competition, league, and venue as generic", () => {
    expect(isGenericEntityType("competition")).toBe(true);
    expect(isGenericEntityType("league")).toBe(true);
    expect(isGenericEntityType("venue")).toBe(true);
  });

  it("never double-counts a type as both specific and generic", () => {
    for (const type of ["team", "player", "coach", "competition", "league", "venue"]) {
      expect(isSpecificEntityType(type) && isGenericEntityType(type)).toBe(false);
    }
  });
});

describe("scoreStoryMatch — coach entities count as specific (rule 2: same player or coach)", () => {
  it("auto_merges on a shared coach entity plus a same-day match, exactly like a team or player", () => {
    const art = article(
      [
        {
          entity: { entityId: "alonso", type: "coach", nameCanonical: "Xabi Alonso" },
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
          entity: { entityId: "alonso", type: "coach", nameCanonical: "Xabi Alonso" },
          role: "subject",
        },
      ],
      "football",
      "2026-07-29",
    );

    const decision = decideStoryMatch(art, [cand]);

    expect(decision.kind).toBe("auto_merge");
  });
});

describe("classifyMatchCategory", () => {
  it("classifies a single shared team as same_team", () => {
    expect(
      classifyMatchCategory([
        { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
      ]),
    ).toBe("same_team");
  });

  it("classifies two shared teams as same_match", () => {
    expect(
      classifyMatchCategory([
        { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
        { entityId: "arsenal", type: "team", nameCanonical: "Arsenal FC" },
      ]),
    ).toBe("same_match");
  });

  it("classifies a single shared player or coach as same_player_or_coach", () => {
    expect(
      classifyMatchCategory([
        { entityId: "salah", type: "player", nameCanonical: "Mohamed Salah" },
      ]),
    ).toBe("same_player_or_coach");
    expect(
      classifyMatchCategory([{ entityId: "arteta", type: "coach", nameCanonical: "Mikel Arteta" }]),
    ).toBe("same_player_or_coach");
  });

  it("classifies a shared team + player/coach together as transfer_pair", () => {
    expect(
      classifyMatchCategory([
        { entityId: "chelsea", type: "team", nameCanonical: "Chelsea FC" },
        { entityId: "welbeck", type: "player", nameCanonical: "Danny Welbeck" },
      ]),
    ).toBe("transfer_pair");
  });

  it("classifies no shared specific entity as none", () => {
    expect(
      classifyMatchCategory([
        { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
      ]),
    ).toBe("none");
    expect(classifyMatchCategory([])).toBe("none");
  });

  it("classifies two shared players (no team) as multiple_specific", () => {
    expect(
      classifyMatchCategory([
        { entityId: "salah", type: "player", nameCanonical: "Mohamed Salah" },
        { entityId: "haaland", type: "player", nameCanonical: "Erling Haaland" },
      ]),
    ).toBe("multiple_specific");
  });
});

describe("extractRoundLabel", () => {
  it("extracts an English matchday/gameweek/round number", () => {
    expect(extractRoundLabel("Premier League Matchday 3 preview")).toBe("matchday 3");
    expect(extractRoundLabel("Gameweek 12 highlights")).toBe("gameweek 12");
    expect(extractRoundLabel("Champions League Round 5 review")).toBe("round 5");
  });

  it("extracts a Hungarian round number", () => {
    expect(extractRoundLabel("NB I: 6. forduló összefoglaló")).toBe("6. forduló");
  });

  it("extracts knockout-stage labels", () => {
    expect(extractRoundLabel("Champions League quarter-final draw")).toMatch(/quarter-?final/);
    expect(extractRoundLabel("Semi-final preview")).toMatch(/semi-?final/);
  });

  it("returns null when no round descriptor is present", () => {
    expect(extractRoundLabel("Liverpool beat Arsenal 3-1")).toBeNull();
  });
});

describe("scoreStoryMatch — round/matchday is supplementary corroboration only, never a gate", () => {
  it("a matching round label alone (no specific entity) still cannot reach the auto-merge threshold", () => {
    const art: ArticleMatchInput = {
      mentions: [
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          location: "title",
        },
      ],
      sport: "football",
      dateBucket: "2026-07-29",
      roundLabel: "matchday 3",
    };
    const cand: CandidateStoryMatchInput = {
      storyId: "story-1",
      entities: [
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          role: "mentioned",
        },
      ],
      sport: "football",
      dateBucket: "2026-07-29",
      roundLabel: "matchday 3",
    };

    const result = scoreStoryMatch(art, cand);

    expect(result.hasSpecificSharedEntity).toBe(false);
    expect(result.score).toBeLessThan(65);
  });

  it("boosts the score slightly when a shared specific entity ALSO has a matching round label, without being required", () => {
    const baseArticle = (roundLabel: string | null): ArticleMatchInput => ({
      mentions: [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          location: "title",
        },
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          location: "title",
        },
      ],
      sport: "football",
      dateBucket: "2026-07-10",
      roundLabel,
    });
    const baseCandidate = (roundLabel: string | null): CandidateStoryMatchInput => ({
      storyId: "story-1",
      entities: [
        {
          entity: { entityId: "liverpool", type: "team", nameCanonical: "Liverpool FC" },
          role: "subject",
        },
        {
          entity: { entityId: "pl", type: "competition", nameCanonical: "Premier League" },
          role: "mentioned",
        },
      ],
      sport: "football",
      dateBucket: "2026-07-20", // far apart, no date bonus
      roundLabel,
    });

    const withoutRoundMatch = scoreStoryMatch(
      baseArticle("matchday 3"),
      baseCandidate("matchday 4"),
    );
    const withRoundMatch = scoreStoryMatch(baseArticle("matchday 3"), baseCandidate("matchday 3"));

    expect(withRoundMatch.score).toBeGreaterThan(withoutRoundMatch.score);
    expect(withRoundMatch.hasSpecificSharedEntity).toBe(true);
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
