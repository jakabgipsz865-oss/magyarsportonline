import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { entityTypeEnum } from "./enums";

/** Csapat/játékos/verseny/liga/helyszín — dedup entitás-egyeztetéshez és SEO-taxonómiához. */
export const entities = pgTable("entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: entityTypeEnum("type").notNull(),
  nameCanonical: text("name_canonical").notNull(),
  nameHu: text("name_hu").notNull(),
  aliases: jsonb("aliases").notNull().default([]),
  externalRef: text("external_ref"),
});
