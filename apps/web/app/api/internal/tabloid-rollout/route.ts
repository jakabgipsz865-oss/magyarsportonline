import { sourceIngest, tabloid } from "@magyarsportonline/agents";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createRepositories } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { publishTabloid } from "../../../../lib/tabloid";
import registry from "../../../../lib/tabloid-sources.json";

export const maxDuration = 300;
const languages = ["en", "es", "it", "de"] as const;
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register") }),
  z.object({ action: z.literal("proof"), language: z.enum(languages) }),
  z.object({ action: z.literal("activate") }),
]);

async function status() {
  const repos = createRepositories();
  const proofs = await Promise.all(
    languages.map(async (language) => {
      const raw = await repos.rawArticleRepository.findTabloidProof(language);
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
    databaseHost: new URL(env.DATABASE_URL).hostname,
    databaseName: new URL(env.DATABASE_URL).pathname.slice(1),
    model: tabloid.TABLOID_MODEL,
    freeOnly: env.GEMINI_FREE_ONLY,
    dailyCap: env.GEMINI_DAILY_REQUEST_CAP,
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
  // Persist one proof identity per language BEFORE any writer call. Repeated
  // requests reuse it and cannot exceed the four-call controlled rollout.
  const rawId = await repos.rawArticleRepository.withTabloidLock(
    `proof:${command.language}`,
    async () => {
      const existing = await repos.rawArticleRepository.findTabloidProof(command.language);
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
              tabloid.isFootballTabloid(item.titleOriginal, item.bodyOriginal, source.footballFeed),
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
              contentOrigin: article.contentOrigin,
              extractedEntities: {
                rssGuid: article.guid ?? article.sourceUrl,
                tabloidProofLanguage: command.language,
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
