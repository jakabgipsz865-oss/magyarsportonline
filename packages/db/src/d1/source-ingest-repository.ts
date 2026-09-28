import type { Source } from "../repositories/source-repository";
import { d1Timestamp, type D1Client } from "./client";

type IngestSource = Pick<Source, "id" | "name" | "language" | "fetchConfig">;

interface SourceRow {
  id: string;
  name: string;
  language: string;
  fetch_config: string;
}

/** Only the source operations needed by the RSS receipt path. */
export class D1SourceIngestRepository {
  constructor(private readonly db: D1Client) {}

  async listActive(now = new Date()): Promise<IngestSource[]> {
    const rows = await this.db.prepare(`
      SELECT id, name, language, fetch_config FROM sources
      WHERE is_active = 1 AND (
        last_fetched_at IS NULL OR polling_frequency_minutes IS NULL OR
        julianday(last_fetched_at) <= julianday(?) - polling_frequency_minutes / 1440.0
      )
      ORDER BY last_fetched_at IS NOT NULL, julianday(last_fetched_at), id
    `).bind(d1Timestamp(now)).all<SourceRow>();
    return rows.results.map(row => ({ id: row.id, name: row.name,
      language: row.language, fetchConfig: JSON.parse(row.fetch_config) as Source["fetchConfig"] }));
  }

  async recordFetchResult(
    sourceId: string,
    result: { status: "ok" | "error"; fetchedAt?: Date },
  ): Promise<void> {
    const at = d1Timestamp(result.fetchedAt ?? new Date());
    await this.db.prepare(`
      UPDATE sources SET last_fetch_status=?, last_fetched_at=?,
        last_success_at=CASE WHEN ?='ok' THEN ? ELSE last_success_at END,
        last_error_at=CASE WHEN ?='error' THEN ? ELSE last_error_at END
      WHERE id=?
    `).bind(result.status, at, result.status, at,
      result.status, at, sourceId).run();
  }
}
