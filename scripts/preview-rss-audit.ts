import { readFile, writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../packages/db/src/client";
import { sql } from "../packages/db/node_modules/drizzle-orm";
const report = JSON.parse(await readFile("docs/preview-rss-validation.json", "utf8"));
const connection = (await readFile("/private/tmp/mso-preview-validation-db", "utf8")).trim();
if (new URL(connection).hostname !== "ep-withered-voice-a2h3cwp5-pooler.eu-central-1.aws.neon.tech")
  throw new Error("Preview target mismatch");
const db = createDatabaseClient(connection);
try {
  const rows =
    await db.execute(sql`SELECT r.id,r.source_id,r.source_url,r.title_original,r.body_original,r.image_url,r.story_id,
    s.name AS source,r.extracted_entities->'previewValidation' AS decision
    FROM raw_articles r JOIN sources s ON s.id=r.source_id
    WHERE r.extracted_entities->'previewValidation'->>'runId'=${report.runId}`);
  await writeFile("docs/preview-rss-readback.json", JSON.stringify(rows, null, 2) + "\n");
  for (const r of rows) {
    if (
      /car.*(?:crash|roof)|crash.*(?:car|land rover)|Horner|Kone, niente|traps including|Brignoli|Jordan|Darren Fletcher|attacke|Glamour-Paar|Eto|Leotta|Olise.*(?:interview|intervista)/i.test(
        r.title_original as string,
      )
    )
      console.log(
        JSON.stringify({
          id: r.id,
          source: r.source,
          title: r.title_original,
          decision: r.decision,
          body: String(r.body_original).slice(0, 1400),
        }),
      );
  }
} finally {
  await db.$client.end({ timeout: 5 });
}
process.exit(0);
