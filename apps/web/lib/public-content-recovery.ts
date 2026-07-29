import { hungarianWriter, publishGate } from "@magyarsportonline/agents";
import type {
  FactRepository,
  ReviewQueueRepository,
  StoryReadModelRepository,
  StoryRepository,
  StorySourceRepository,
  StoryVersionRepository,
} from "@magyarsportonline/db";

export interface PublicContentRecoveryDeps {
  storyReadModelRepository: Pick<StoryReadModelRepository, "listPublished" | "deleteByStoryId">;
  storyRepository: Pick<StoryRepository, "getById" | "updateStatus">;
  storyVersionRepository: Pick<StoryVersionRepository, "getById">;
  factRepository: Pick<FactRepository, "listByStoryId">;
  storySourceRepository: Pick<
    StorySourceRepository,
    "countByStoryId" | "countFullArticleByStoryId"
  >;
  reviewQueueRepository: Pick<ReviewQueueRepository, "rejectAllPendingForStory">;
}

export interface PublicRecoveryItem {
  storyId: string;
  slug: string;
  titleHu: string;
  leadHu: string;
  publishedAt: string;
  action: "kept" | "retracted";
  blockers: string[];
}

export interface PublicContentRecoveryResult {
  dryRun: boolean;
  scanned: number;
  kept: number;
  retracted: number;
  items: PublicRecoveryItem[];
}

function blockerLabel(blocker: publishGate.PublicationBlocker): string {
  if (!blocker.qualityIssue) {
    return blocker.kind;
  }
  return `${blocker.kind}:${blocker.qualityIssue.field}:${blocker.qualityIssue.kind}`;
}

/**
 * Re-runs the current fail-closed publication invariant against every row
 * that is actually visible on the public site. Unsafe rows are removed only
 * from the public projection and marked retracted; versions and source data
 * remain intact, making the operation auditable and reversible.
 */
export async function recoverUnsafePublicContent(
  deps: PublicContentRecoveryDeps,
  options: { apply: boolean; limit?: number },
): Promise<PublicContentRecoveryResult> {
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const publicRows = await deps.storyReadModelRepository.listPublished({ limit, offset: 0 });
  const items: PublicRecoveryItem[] = [];

  for (const publicRow of publicRows) {
    const story = await deps.storyRepository.getById(publicRow.storyId);
    const version = story?.currentVersionId
      ? await deps.storyVersionRepository.getById(story.currentVersionId)
      : null;
    let blockers: string[];

    if (!story || !version) {
      blockers = ["missing_story_or_current_version"];
    } else {
      const [facts, sourceCount, fullArticleSourceCount] = await Promise.all([
        deps.factRepository.listByStoryId(story.id),
        deps.storySourceRepository.countByStoryId(story.id),
        deps.storySourceRepository.countFullArticleByStoryId(story.id),
      ]);
      blockers = publishGate
        .assessPublicationReadiness({
          titleHu: version.titleHu,
          leadHu: version.leadHu,
          bodyHu: version.bodyHu,
          facts: facts.map(hungarianWriter.toWriterFact),
          isAiGenerated: version.isAiGenerated,
          factConsistencyScore:
            version.factConsistencyScore === null ? null : Number(version.factConsistencyScore),
          selfCheckFallback: version.selfCheckFallback,
          credibilityScore: story.credibilityScore,
          sourceCount,
          fullArticleSourceCount,
        })
        .blockers.map(blockerLabel);
    }

    const unsafe = blockers.length > 0;
    if (unsafe && options.apply) {
      await deps.storyRepository.updateStatus(publicRow.storyId, "retracted");
      await deps.reviewQueueRepository.rejectAllPendingForStory(
        publicRow.storyId,
        `Publikus P0 content recovery: ${blockers.join(", ")}`,
      );
      await deps.storyReadModelRepository.deleteByStoryId(publicRow.storyId);
    }

    items.push({
      storyId: publicRow.storyId,
      slug: publicRow.slug,
      titleHu: publicRow.titleHu,
      leadHu: publicRow.leadHu,
      publishedAt: publicRow.publishedAt.toISOString(),
      action: unsafe && options.apply ? "retracted" : "kept",
      blockers,
    });
  }

  return {
    dryRun: !options.apply,
    scanned: items.length,
    kept: items.filter((item) => item.blockers.length === 0).length,
    retracted: options.apply
      ? items.filter((item) => item.action === "retracted").length
      : items.filter((item) => item.blockers.length > 0).length,
    items,
  };
}
