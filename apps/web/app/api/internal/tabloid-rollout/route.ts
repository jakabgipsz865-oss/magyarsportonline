import { sourceIngest, tabloid } from "@magyarsportonline/agents";
import type { TabloidSourceMode } from "@magyarsportonline/shared";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createRepositories } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { mergeInlineImages, publishTabloid } from "../../../../lib/tabloid";
import registry from "../../../../lib/tabloid-sources.json";

export const maxDuration = 300;
const languages = ["en", "es", "it", "de"] as const;
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register") }),
  z.object({ action: z.literal("reset-sources"), sourceIds: z.array(z.string().uuid()).max(40) }),
  z.object({ action: z.literal("proof"), language: z.enum(languages) }),
  z.object({ action: z.literal("retry-proof"), language: z.enum(languages) }),
  z.object({ action: z.literal("retry-article"), rawArticleId: z.string().uuid() }),
  z.object({ action: z.literal("rewrite-article"), rawArticleId: z.string().uuid() }),
  z.object({ action: z.literal("rewrite-story"), slug: z.string().min(1).max(240) }),
  z.object({ action: z.literal("activate") }),
]);

async function status() {
  const repos = createRepositories();
  const databaseUrl = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
  const proofs = await Promise.all(
    languages.map(async (language) => {
      const raw = await repos.rawArticleRepository.findTabloidProof(
        language,
        tabloid.TABLOID_PROMPT,
      );
      const version = raw?.storyId
        ? await repos.storyVersionRepository.getLatestPublished(raw.storyId)
        : null;
      return {
        language,
        pass: version?.promptVersion === tabloid.TABLOID_PROMPT,
        rawArticleId: raw?.id ?? null,
        storyId: raw?.storyId ?? null,
        versionId: version?.id ?? null,
        model: version?.generatedByModel ?? null,
      };
    }),
  );
  return {
    proofs,
    autoPublish: env.TABLOID_AUTO_PUBLISH,
    promptVersion: tabloid.TABLOID_PROMPT,
    databaseHost: databaseUrl?.hostname ?? "hyperdrive",
    databaseName: databaseUrl?.pathname.slice(1) ?? null,
    model: tabloid.TABLOID_MODEL,
    freeOnly: env.GEMINI_FREE_ONLY,
    dailyCap: env.GEMINI_DAILY_REQUEST_CAP,
    activeSources: (await repos.sourceRepository.listAll())
      .filter((source) => source.isActive)
      .map((source) => ({
        id: source.id,
        name: source.name,
      })),
    configuredSources: registry.map((source) => ({
      id: source.id,
      name: source.name,
      mode: source.mode,
    })),
  };
}

export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await status());
}

export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  if (parsed.data.action === "reset-sources") {
    if (env.TABLOID_AUTO_PUBLISH)
      return NextResponse.json(
        { error: "Pause publication before resetting sources" },
        { status: 409 },
      );
    const requestedIds = parsed.data.sourceIds;
    if (requestedIds.some((id) => !registry.some((source) => source.id === id)))
      return NextResponse.json(
        { error: "Only configured source IDs are allowed" },
        { status: 400 },
      );
    const repos = createRepositories();
    await repos.sourceRepository.pauseTabloidSources();
    for (const source of registry.filter((source) => requestedIds.includes(source.id)))
      await repos.sourceRepository.registerTabloidSource(source);
    return NextResponse.json({ registered: requestedIds.length, active: false, llmCalls: 0 });
  }
  if (!env.TABLOID_AUTO_PUBLISH)
    return NextResponse.json({ paused: true, llmCalls: 0 }, { status: 409 });
  const repos = createRepositories();
  const command = parsed.data;
  if (command.action === "register") {
    for (const source of registry) await repos.sourceRepository.registerTabloidSource(source);
    return NextResponse.json({ registered: registry.length, active: false, llmCalls: 0 });
  }
  if (command.action === "activate") {
    const proof = await status();
    if (!proof.proofs.every((item) => item.pass))
      return NextResponse.json(
        { error: "all four language proofs required", ...proof },
        { status: 409 },
      );
    await repos.sourceRepository.activateTabloidSources(registry.map((source) => source.id));
    return NextResponse.json({
      activeSources: registry.length,
      feeds: Object.fromEntries(
        languages.map((language) => [
          language,
          registry
            .filter((source) => source.language === language)
            .reduce((sum, source) => sum + source.feedUrls.length, 0),
        ]),
      ),
    });
  }
  if (command.action === "retry-proof") {
    const raw = await repos.rawArticleRepository.findTabloidProof(
      command.language,
      tabloid.TABLOID_PROMPT,
    );
    if (!raw) return NextResponse.json({ error: "proof article not found" }, { status: 404 });
    const result = await publishTabloid(raw.id, repos, { retryFailedWriter: true });
    return NextResponse.json({ language: command.language, ...result });
  }
  if (
    command.action === "retry-article" ||
    command.action === "rewrite-article" ||
    command.action === "rewrite-story"
  ) {
    const storyRow =
      command.action === "rewrite-story"
        ? await repos.storyReadModelRepository.getBySlug(command.slug)
        : null;
    if (command.action === "rewrite-story" && !storyRow)
      return NextResponse.json({ error: "recoverable tabloid article not found" }, { status: 404 });
    const raw =
      command.action === "rewrite-story"
        ? (await repos.rawArticleRepository.listByStoryId(storyRow!.storyId)).find((item) =>
            registry.some((source) => source.id === item.sourceId),
          )
        : await repos.rawArticleRepository.getById(command.rawArticleId);
    if (!raw || !raw.storyId || !registry.some((source) => source.id === raw.sourceId))
      return NextResponse.json({ error: "recoverable tabloid article not found" }, { status: 404 });
    if (command.action === "rewrite-article" || command.action === "rewrite-story") {
      const source = await repos.sourceRepository.getById(raw.sourceId);
      const config = source?.fetchConfig as { url?: string; feedUrls?: string[] } | undefined;
      if (source && config?.url) {
        const adapter = new sourceIngest.RssSourceAdapter(undefined, false);
        const feeds = await Promise.allSettled(
          (config.feedUrls ?? [config.url]).map((url) => adapter.fetch({ url })),
        );
        const rssArticle = feeds
          .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
          .find((article) => article.sourceUrl === raw.sourceUrl);
        const [fullArticle, pageMedia] = await Promise.all([
          new sourceIngest.ArticleFetcher().fetch(raw.sourceUrl),
          sourceIngest.fetchArticleMedia(raw.sourceUrl, config.url),
        ]);
        const inlineImages = mergeInlineImages(
          raw.inlineImages,
          rssArticle?.inlineImages,
          pageMedia?.inlineImages,
        );
        if (!fullArticle || !pageMedia) {
          return NextResponse.json(
            { error: "complete source page unavailable", rawArticleId: raw.id },
            { status: 422 },
          );
        }
        if (raw.contentOrigin === "rss_snippet") {
          await repos.rawArticleRepository.upgradeFromFullArticle(raw.id, {
            sourceUrl: raw.sourceUrl,
            titleOriginal: fullArticle.titleOriginal || raw.titleOriginal,
            subtitleOriginal: fullArticle.subtitleOriginal,
            bodyOriginal: fullArticle.bodyOriginal,
            authorOriginal: fullArticle.authorOriginal,
            publishedAtSource: fullArticle.publishedAtSource ?? raw.publishedAtSource,
            imageUrl: raw.imageUrl ?? rssArticle?.imageUrl ?? pageMedia?.primary?.url ?? null,
            inlineImages,
          });
        }
        if (inlineImages.length > 0 || pageMedia?.primary || rssArticle?.imageUrl) {
          await repos.rawArticleRepository.updateInlineImages(
            raw.id,
            inlineImages,
            raw.imageUrl ?? rssArticle?.imageUrl ?? pageMedia?.primary?.url,
          );
        }
      }
    }
    const result = await publishTabloid(
      raw.id,
      repos,
      command.action === "retry-article"
        ? { retryFailedWriter: true }
        : { retryFailedWriter: true, forceRewrite: true },
    );
    return NextResponse.json({ rawArticleId: raw.id, ...result });
  }
  // Persist one proof identity per language BEFORE any writer call. Repeated
  // requests reuse it and cannot exceed the four-call controlled rollout.
  const rawId = await repos.rawArticleRepository.withTabloidLock(
    `proof:${tabloid.TABLOID_PROMPT}:${command.language}`,
    async () => {
      const existing = await repos.rawArticleRepository.findTabloidProof(
        command.language,
        tabloid.TABLOID_PROMPT,
      );
      if (existing) return existing.id;
      const candidates = registry.filter((source) => source.language === command.language);
      const adapter = new sourceIngest.RssSourceAdapter(undefined, false);
      for (const source of candidates) {
        if (!(await repos.sourceRepository.getById(source.id)))
          throw new Error("Register sources before proof");
        for (const url of source.feedUrls) {
          let articles;
          try {
            articles = await adapter.fetch({ url });
          } catch {
            continue;
          }
          const article = articles.find(
            (item) =>
              item.bodyOriginal.trim() &&
              tabloid.isFootballTabloid(
                item.titleOriginal,
                item.bodyOriginal,
                source.footballFeed,
                source.mode as TabloidSourceMode,
              ),
          );
          if (!article) continue;
          const raw = await repos.rawArticleRepository.insertTabloid(
            {
              sourceId: source.id,
              sourceUrl: article.sourceUrl,
              titleOriginal: article.titleOriginal,
              bodyOriginal: article.bodyOriginal,
              language: command.language,
              publishedAtSource: article.publishedAtSource,
              imageUrl: article.imageUrl,
              inlineImages: article.inlineImages ?? [],
              contentOrigin: article.contentOrigin,
              extractedEntities: {
                rssGuid: article.guid ?? article.sourceUrl,
                tabloidProofLanguage: command.language,
                tabloidProofGeneration: tabloid.TABLOID_PROMPT,
              },
            },
            false,
          );
          if (raw) return raw.id;
        }
      }
      throw new Error("No usable preflighted RSS article for this language");
    },
  );
  const result = await publishTabloid(rawId, repos);
  return NextResponse.json({ language: command.language, ...result });
}
