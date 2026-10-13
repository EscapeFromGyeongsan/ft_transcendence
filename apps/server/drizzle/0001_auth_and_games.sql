CREATE TABLE "game_commands" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "game_commands_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"command_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"expected_version" integer NOT NULL,
	"applied_version" integer,
	"status" text NOT NULL,
	"reject_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_commands_game_command_unique" UNIQUE("game_id","command_id"),
	CONSTRAINT "game_commands_status_check" CHECK (("game_commands"."status" = 'applied' AND "game_commands"."applied_version" IS NOT NULL AND "game_commands"."reject_code" IS NULL) OR ("game_commands"."status" = 'rejected' AND "game_commands"."applied_version" IS NULL AND "game_commands"."reject_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "game_players_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"seat" text NOT NULL,
	"result" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "game_players_game_user_unique" UNIQUE("game_id","user_id"),
	CONSTRAINT "game_players_game_seat_unique" UNIQUE("game_id","seat"),
	CONSTRAINT "game_players_seat_check" CHECK ("game_players"."seat" IN ('black', 'white')),
	CONSTRAINT "game_players_result_check" CHECK ("game_players"."result" IS NULL OR "game_players"."result" IN ('win', 'loss', 'draw', 'void'))
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_type" text NOT NULL,
	"rules_version" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"current_turn" text,
	"outcome" text,
	"result_reason" text,
	"winner_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_game_type_check" CHECK ("games"."game_type" IN ('gomoku', 'othello')),
	CONSTRAINT "games_status_check" CHECK ("games"."status" IN ('waiting', 'playing', 'paused', 'finished')),
	CONSTRAINT "games_current_turn_check" CHECK ("games"."current_turn" IS NULL OR "games"."current_turn" IN ('black', 'white')),
	CONSTRAINT "games_outcome_check" CHECK ("games"."outcome" IS NULL OR "games"."outcome" IN ('win', 'draw', 'void')),
	CONSTRAINT "games_result_check" CHECK (("games"."status" = 'finished') = ("games"."outcome" IS NOT NULL AND "games"."result_reason" IS NOT NULL AND "games"."finished_at" IS NOT NULL)),
	CONSTRAINT "games_winner_check" CHECK (("games"."outcome" = 'win') = ("games"."winner_user_id" IS NOT NULL)),
	CONSTRAINT "games_state_version_check" CHECK ("games"."state_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"turn_number" integer NOT NULL,
	"row_idx" smallint NOT NULL,
	"col_idx" smallint NOT NULL,
	"stone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moves_game_turn_unique" UNIQUE("game_id","turn_number"),
	CONSTRAINT "moves_game_cell_unique" UNIQUE("game_id","row_idx","col_idx"),
	CONSTRAINT "moves_row_check" CHECK ("moves"."row_idx" BETWEEN 0 AND 14),
	CONSTRAINT "moves_col_check" CHECK ("moves"."col_idx" BETWEEN 0 AND 14),
	CONSTRAINT "moves_stone_check" CHECK ("moves"."stone" IN ('black', 'white')),
	CONSTRAINT "moves_turn_check" CHECK ("moves"."turn_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refresh_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"nickname" varchar(32) NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_nickname_unique" UNIQUE("nickname")
);
--> statement-breakpoint
ALTER TABLE "game_commands" ADD CONSTRAINT "game_commands_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_commands" ADD CONSTRAINT "game_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_players_user_result_idx" ON "game_players" USING btree ("user_id","result");--> statement-breakpoint
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");