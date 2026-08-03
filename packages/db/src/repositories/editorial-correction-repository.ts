import { desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { editorialCorrections } from "../schema/index";
import { portableEditorialCorrectionKey } from "./knowledge-portability-repository";

export type EditorialCorrectionRow = typeof editorialCorrections.$inferSelect;
export type EditorialCorrectionCategory = EditorialCorrectionRow["category"];

export interface EditorialCorrectionInput {
  storyId: string;
  category: EditorialCorrectionCategory;
  termEn: string | null;
  originalSentenceEn: string;
  currentSentenceHu: string;
  correctedSentenceHu: string;
  note: string | null;
}

/**
 * Az emberi szerkesztői visszajelzésből épülő tanítóanyag tárolója
 * (2026-07-28-i "tanítható szerkesztői felület" sprint) — sosem módosít,
 * sosem töröl, csak felvesz. Lásd packages/agents/src/shared/
 * editorial-corrections.ts a levezetett lexikon/prompt-példatár logikáért.
 */
export class EditorialCorrectionRepository {
  constructor(private readonly db: Database) {}

  async create(input: EditorialCorrectionInput): Promise<EditorialCorrectionRow> {
    const portableKey = portableEditorialCorrectionKey({
      category: input.category,
      termEn: input.termEn,
      originalSentenceEn: input.originalSentenceEn,
      currentSentenceHu: input.currentSentenceHu,
      correctedSentenceHu: input.correctedSentenceHu,
      note: input.note,
    });
    const [created] = await this.db
      .insert(editorialCorrections)
      .values({ ...input, portableKey })
      .onConflictDoNothing({ target: editorialCorrections.portableKey })
      .returning();
    if (created) return created;

    const [existing] = await this.db
      .select()
      .from(editorialCorrections)
      .where(eq(editorialCorrections.portableKey, portableKey))
      .limit(1);
    if (!existing) throw new Error("EditorialCorrection upsert returned no row");
    return existing;
  }

  /** Legfrissebb elöl — a review oldal és a jövőbeli generálás egyaránt ezt a sorrendet várja. */
  async listAll(): Promise<EditorialCorrectionRow[]> {
    return this.db
      .select()
      .from(editorialCorrections)
      .orderBy(desc(editorialCorrections.createdAt));
  }

  async listRecent(limit: number): Promise<EditorialCorrectionRow[]> {
    return this.db
      .select()
      .from(editorialCorrections)
      .orderBy(desc(editorialCorrections.createdAt))
      .limit(limit);
  }
}
