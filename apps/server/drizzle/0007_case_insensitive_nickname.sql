ALTER TABLE "users" DROP CONSTRAINT "users_nickname_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_unique" ON "users" USING btree (lower("nickname"));