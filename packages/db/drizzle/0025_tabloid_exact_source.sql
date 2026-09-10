ALTER TABLE "raw_articles" DROP CONSTRAINT "raw_articles_source_url_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "raw_articles_source_url_unique" ON "raw_articles" USING btree ("source_id","source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_articles_source_guid_unique" ON "raw_articles" USING btree ("source_id",("extracted_entities"->>'rssGuid'));