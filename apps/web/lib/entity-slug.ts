import type { Entity } from "@magyarsportonline/db";
import { seo } from "@magyarsportonline/agents";

/** Entities have no stored slug column — computed on the fly from the Hungarian display name, same slugify rule as Story slugs. */
export function entitySlug(entity: Pick<Entity, "nameHu">): string {
  return seo.slugify(entity.nameHu);
}
