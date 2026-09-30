import { NextResponse } from "next/server";
import { d1Binding } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { recoverSavedDrafts } from "../../../../lib/draft-recovery";
import { unverifiedNumericClaims } from "../../../../../../packages/agents/src/tabloid-numbers";
import manifest from "../../../../../../packages/agents/src/fixtures/number-audit-124-manifest.json";
export const dynamic = "force-dynamic";
// Existing /api/admin/* middleware authenticates this fixed, SELECT-only cohort.
// No caller-controlled IDs/options and no execution/LLM/social path.
export async function GET() {
  const db = d1Binding();
  if (!db || !env.D1_PIPELINE_START_AT)
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const ids = manifest.map((m) => m.id);
  // D1 permits at most 100 bound parameters per statement.
  const chunks = [ids.slice(0, 80), ids.slice(80)];
  const batches = await Promise.all(
    chunks.map(async (chunk) =>
      db
        .prepare(
          `SELECT s.id story_id,r.title_original,r.body_original,r.language,
    v.title_hu,v.lead_hu,v.body_hu FROM stories s
    JOIN story_versions v ON v.story_id=s.id AND v.version_number=(SELECT max(version_number) FROM story_versions WHERE story_id=s.id)
    JOIN story_sources ss ON ss.story_id=s.id AND ss.excluded=0
    JOIN raw_articles r ON r.id=ss.raw_article_id
    WHERE s.id IN (${chunk.map(() => "?").join(",")}) LIMIT 249`,
        )
        .bind(...chunk)
        .all<{
          story_id: string;
          title_original: string;
          body_original: string;
          language: string;
          title_hu: string;
          lead_hu: string;
          body_hu: string;
        }>(),
    ),
  );
  const rows = batches.flatMap((batch) => batch.results);
  const numeric = {
    A: { pass: 0, blocked: 0, changed: 0 },
    B: { pass: 0, blocked: 0, changed: 0 },
    C: { pass: 0, blocked: 0, changed: 0 },
    D: { pass: 0, blocked: 0, changed: 0 },
  };
  for (const item of manifest) {
    const matches = rows.filter((r) => r.story_id === item.id),
      row = matches[0];
    const group = numeric[item.category as keyof typeof numeric];
    if (matches.length !== 1 || !row) {
      group.changed++;
      continue;
    }
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([
          row.title_original,
          row.body_original,
          row.title_hu,
          row.lead_hu,
          row.body_hu,
        ]),
      ),
    );
    const hash = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
    if (hash !== item.sha256) {
      group.changed++;
      continue;
    }
    const errors = unverifiedNumericClaims(
      `${row.title_original}\n${row.body_original}`,
      `${row.title_hu} ${row.lead_hu} ${row.body_hu}`,
      { sourceLanguage: row.language },
    );
    if (errors.length) group.blocked++;
    else group.pass++;
  }
  const decisions = await recoverSavedDrafts(db, ids, {
    activationAt: env.D1_PIPELINE_START_AT,
    forceReviewMode: env.FORCE_REVIEW_MODE,
    execute: false,
    executionEnabled: false,
  });
  return NextResponse.json(
    {
      dryRun: true,
      writerCalls: 0,
      facebookEnqueued: 0,
      numeric,
      publishable: decisions.filter((d) => d.publishable).length,
      blocked: decisions.filter((d) => !d.publishable).length,
      results: decisions,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
