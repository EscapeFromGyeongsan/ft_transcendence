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

/**
 * 플랫폼 계정에 연결된 외부 계정입니다.
 *
 * @remarks
 * UNIQUE 제약으로 제공자 사용자 하나는 계정 하나에만, 계정 하나는 제공자마다 최대 하나의 연결만 가집니다.
 */
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

/**
 * 한 번만 쓰는 OAuth `state`입니다. 위조된 callback과 재전송된 응답을 막습니다.
 *
 * @remarks
 * `browser_hash`는 흐름을 시작한 브라우저에 묶습니다(login CSRF 방지).
 * `mode`가 `link`이면 사용자와 세션도 기록하고 callback에서 다시 확인합니다. CHECK 제약이 mode별 필수 열을 강제합니다.
 */
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

/**
 * 사용자의 TOTP secret입니다(AES-256-GCM 암호문).
 *
 * @remarks
 * `enabled_at`이 NULL이면 설정을 시작했지만 확인하지 않은 상태입니다. `last_used_step`으로 같은 코드의 재사용을 막습니다.
 */
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

/** 2FA 복구 코드입니다. 해시만 저장하고, 사용하면 `used_at`을 채워 다시 쓸 수 없게 합니다. */
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

/** 2FA 계정의 로그인(비밀번호·OAuth) 두 번째 단계를 기다리는 challenge입니다. 토큰 해시만 저장합니다. */
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
