import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sessions, users } from "./users.ts";

// External identity linked to a platform account. One account per provider
// user, and at most one link per provider for each platform account.
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("oauth_accounts_provider_user_unique").on(
      table.provider,
      table.providerUserId,
    ),
    unique("oauth_accounts_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
  ],
);

// One-time OAuth `state`. Blocks forged callbacks and replayed responses.
// browser_hash binds the flow to the browser that started it (login CSRF);
// mode "link" also records the user and session, rechecked at callback.
export const oauthStates = pgTable(
  "oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id, {
      onDelete: "cascade",
    }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    browserHash: text("browser_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "oauth_states_mode_check",
      sql`(${table.mode} = 'login' AND ${table.userId} IS NULL AND ${table.sessionId} IS NULL) OR (${table.mode} = 'link' AND ${table.userId} IS NOT NULL AND ${table.sessionId} IS NOT NULL)`,
    ),
  ],
);

// TOTP secret (AES-256-GCM encrypted). enabled_at NULL means setup started
// but not confirmed. last_used_step blocks reusing a code.
export const twoFactorSecrets = pgTable("two_factor_secrets", {
  userId: bigint("user_id", { mode: "number" })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretEncrypted: text("secret_encrypted").notNull(),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  lastUsedStep: integer("last_used_step"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const twoFactorRecoveryCodes = pgTable(
  "two_factor_recovery_codes",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [index("two_factor_recovery_codes_user_idx").on(table.userId)],
);

// Pending second step of a login (password or OAuth) for a 2FA account.
export const twoFactorChallenges = pgTable(
  "two_factor_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    // Wrong codes against this challenge; it is discarded after the limit.
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("two_factor_challenges_user_idx").on(table.userId)],
);
