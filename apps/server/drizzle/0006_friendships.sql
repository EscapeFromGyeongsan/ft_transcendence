CREATE TABLE "friendships" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "friendships_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_low_id" bigint NOT NULL,
	"user_high_id" bigint NOT NULL,
	"requested_by_id" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	CONSTRAINT "friendships_pair_unique" UNIQUE("user_low_id","user_high_id"),
	CONSTRAINT "friendships_pair_order_check" CHECK ("friendships"."user_low_id" < "friendships"."user_high_id"),
	CONSTRAINT "friendships_requester_check" CHECK ("friendships"."requested_by_id" IN ("friendships"."user_low_id", "friendships"."user_high_id")),
	CONSTRAINT "friendships_status_check" CHECK ("friendships"."status" IN ('pending', 'accepted', 'declined')),
	CONSTRAINT "friendships_timestamps_check" CHECK (("friendships"."status" = 'pending' AND "friendships"."accepted_at" IS NULL AND "friendships"."declined_at" IS NULL)
        OR ("friendships"."status" = 'accepted' AND "friendships"."accepted_at" IS NOT NULL AND "friendships"."declined_at" IS NULL)
        OR ("friendships"."status" = 'declined' AND "friendships"."accepted_at" IS NULL AND "friendships"."declined_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_low_id_users_id_fk" FOREIGN KEY ("user_low_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_high_id_users_id_fk" FOREIGN KEY ("user_high_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friendships_high_idx" ON "friendships" USING btree ("user_high_id");