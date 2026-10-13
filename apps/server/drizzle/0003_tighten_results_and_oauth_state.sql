-- OAuth states are 10-minute, single-use rows; drop pending ones so browser_hash can be NOT NULL.
DELETE FROM "oauth_states";--> statement-breakpoint
ALTER TABLE "oauth_states" DROP CONSTRAINT "oauth_states_mode_check";--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "games_result_check";--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "games_winner_check";--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "browser_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_mode_check" CHECK (("oauth_states"."mode" = 'login' AND "oauth_states"."user_id" IS NULL AND "oauth_states"."session_id" IS NULL) OR ("oauth_states"."mode" = 'link' AND "oauth_states"."user_id" IS NOT NULL AND "oauth_states"."session_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_result_check" CHECK (("games"."status" = 'finished' AND "games"."outcome" IS NOT NULL AND "games"."result_reason" IS NOT NULL AND "games"."finished_at" IS NOT NULL) OR ("games"."status" <> 'finished' AND "games"."outcome" IS NULL AND "games"."result_reason" IS NULL AND "games"."finished_at" IS NULL AND "games"."winner_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_winner_check" CHECK (("games"."outcome" = 'win' AND "games"."winner_user_id" IS NOT NULL) OR ("games"."outcome" IS DISTINCT FROM 'win' AND "games"."winner_user_id" IS NULL));