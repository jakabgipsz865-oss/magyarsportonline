import { schema, type Database } from "@magyarsportonline/db";

export interface DemoSeed {
  dunaFcId: string;
  tiszaSeId: string;
  categorySlug: string;
  sourceA: { id: string; baseUrl: string };
  sourceB: { id: string; baseUrl: string };
}

/**
 * Seeds the minimal reference data the MVP demo pipeline needs: two team
 * entities (for the fingerprint-based dedup, docs/adr/0006-mvp-fingerprint-only-dedup.md)
 * and two Source rows pointing at the local fixture RSS server
 * (scripts/fixture-server.ts). Assumes the caller already truncated all
 * tables — this is demo/dev seeding, not a production onboarding flow
 * (that's docs/architecture/08-roadmap.md Fázis 12, 98. lépés).
 */
export async function seedDemoData(db: Database, fixtureServerBaseUrl: string): Promise<DemoSeed> {
  const [dunaFc] = await db
    .insert(schema.entities)
    .values({ type: "team", nameCanonical: "Duna FC", nameHu: "Duna FC", aliases: ["Duna"] })
    .returning();
  const [tiszaSe] = await db
    .insert(schema.entities)
    .values({ type: "team", nameCanonical: "Tisza SE", nameHu: "Tisza SE", aliases: [] })
    .returning();
  if (!dunaFc || !tiszaSe) throw new Error("failed to seed entities");

  await db.insert(schema.categories).values({ slug: "labdarugas", nameHu: "Labdarúgás" });

  const [sourceA] = await db
    .insert(schema.sources)
    .values({
      name: "Demo Sporthír Ügynökség",
      baseUrl: `${fixtureServerBaseUrl}/source-a.xml`,
      type: "rss",
      language: "hu",
      licenseType: "public_rss",
      reliabilityTier: "B",
      fetchConfig: {},
      isActive: true,
    })
    .returning();
  const [sourceB] = await db
    .insert(schema.sources)
    .values({
      name: "Demo Sport Extra",
      baseUrl: `${fixtureServerBaseUrl}/source-b.xml`,
      type: "rss",
      language: "hu",
      licenseType: "public_rss",
      reliabilityTier: "A",
      fetchConfig: {},
      isActive: true,
    })
    .returning();
  if (!sourceA || !sourceB) throw new Error("failed to seed sources");

  return {
    dunaFcId: dunaFc.id,
    tiszaSeId: tiszaSe.id,
    categorySlug: "labdarugas",
    sourceA: { id: sourceA.id, baseUrl: sourceA.baseUrl },
    sourceB: { id: sourceB.id, baseUrl: sourceB.baseUrl },
  };
}
