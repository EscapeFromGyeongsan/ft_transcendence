import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  // NULL for accounts created through OAuth only (no password login).
  passwordHash: text("password_hash"),
  nickname: varchar("nickname", { length: 32 }).notNull().unique(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  // Set on account deletion (DEC-09). The row stays so match history keeps
  // its user id; email and nickname are replaced with placeholders.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * 서버 세션입니다. access token이 이 ID(`sid`)를 담습니다.
 *
 * @remarks
 * 로그아웃이나 refresh token 재사용 감지로 `revoked_at`이 채워지면, 만료 전 access token으로 온 요청도 모두 거절됩니다.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * refresh token 회전 기록입니다. 토큰 해시만 저장합니다.
 *
 * @remarks
 * 이미 회전된 토큰(`used_at` 있음)이 다시 쓰이면 탈취로 보고 그 세션을 폐기합니다.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("refresh_tokens_session_id_idx").on(table.sessionId)],
);
