import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createRepositories } from "../../lib/db";
import { entitySlug } from "../../lib/entity-slug";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Csapatok és bajnokságok" };

const TYPE_LABELS_HU: Record<string, string> = {
  team: "Csapat",
  player: "Játékos",
  competition: "Verseny",
  league: "Bajnokság",
  venue: "Helyszín",
};

export default async function TeamsIndexPage(): Promise<ReactNode> {
  const { entityRepository } = createRepositories();
  const entities = await entityRepository.listAll();

  return (
    <main className="public-surface">
      <div className="taxonomy-header">
        <div className="taxonomy-header__mark" aria-hidden="true">
          CS
        </div>
        <h1>Csapatok &amp; bajnokságok</h1>
      </div>
      {entities.length === 0 ? (
        <p className="empty-state">Még nincs feltöltött csapat vagy bajnokság.</p>
      ) : (
        <div className="taxonomy-grid">
          {entities.map((entity) => (
            <Link key={entity.id} href={`/csapat/${entitySlug(entity)}`} className="taxonomy-tile">
              <div className="taxonomy-tile__type">
                {TYPE_LABELS_HU[entity.type] ?? entity.type}
              </div>
              <div className="taxonomy-tile__name">{entity.nameHu}</div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
