import { desc, inArray } from "drizzle-orm";
import type { Database } from "../client";
import { editorialCorrectionApplications } from "../schema/index";

export type EditorialCorrectionApplicationRow = typeof editorialCorrectionApplications.$inferSelect;
export type CorrectionApplicationStage = EditorialCorrectionApplicationRow["stage"];
export type CorrectionApplicationVerdict = EditorialCorrectionApplicationRow["verdict"];

export interface EditorialCorrectionApplicationInput {
  correctionId: string;
  storyId: string;
  stage: CorrectionApplicationStage;
  verdict: CorrectionApplicationVerdict;
  evidence: string | null;
}

/**
 * Mérési eseménynapló arra, hogy egy elfogadott szerkesztői javítás
 * ténylegesen befolyásolta-e a KÖVETKEZŐ generálásokat (2026-07-28-i "mérhető
 * szerkesztői memória" sprint) — lásd packages/agents/src/shared/
 * correction-effectiveness.ts a kiértékelő és összegző logikáért. Sosem
 * módosít, sosem töröl, csak felvesz — a nyers eseménysorból vezetjük le a
 * trendet (javult/romlott) az admin oldalon.
 */
export class EditorialCorrectionApplicationRepository {
  constructor(private readonly db: Database) {}

  async create(
    input: EditorialCorrectionApplicationInput,
  ): Promise<EditorialCorrectionApplicationRow> {
    const [row] = await this.db.insert(editorialCorrectionApplications).values(input).returning();
    if (!row) {
      throw new Error("EditorialCorrectionApplication insert returned no row");
    }
    return row;
  }

  async listAll(): Promise<EditorialCorrectionApplicationRow[]> {
    return this.db
      .select()
      .from(editorialCorrectionApplications)
      .orderBy(desc(editorialCorrectionApplications.detectedAt));
  }

  async listByCorrectionIds(correctionIds: string[]): Promise<EditorialCorrectionApplicationRow[]> {
    if (correctionIds.length === 0) {
      return [];
    }
    return this.db
      .select()
      .from(editorialCorrectionApplications)
      .where(inArray(editorialCorrectionApplications.correctionId, correctionIds))
      .orderBy(desc(editorialCorrectionApplications.detectedAt));
  }
}
