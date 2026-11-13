ALTER TABLE "game_players" ADD COLUMN "nickname_snapshot" varchar(32);--> statement-breakpoint
UPDATE "game_players" SET "nickname_snapshot" = "users"."nickname" FROM "users" WHERE "users"."id" = "game_players"."user_id";--> statement-breakpoint
ALTER TABLE "game_players" ALTER COLUMN "nickname_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;
