import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * 사용자 한 쌍의 친구 요청 및 관계를 유일하게 저장합니다.
 *
 * @remarks
 * ID가 작은 사용자를 low, 큰 사용자를 high로 고정합니다. 거절된 요청은
 * 차단 정책을 위해 보존하며, 거절자가 다시 요청하면 이전 행을 삭제한
 * 뒤 새 identity ID를 발급해야 오래된 탭의 요청이 재사용되지 않습니다.
 */
export const friendships = pgTable(
  "friendships",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userLowId: bigint("user_low_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHighId: bigint("user_high_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedById: bigint("requested_by_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
  },
  (table) => [
    unique("friendships_pair_unique").on(table.userLowId, table.userHighId),
    index("friendships_high_idx").on(table.userHighId),
    check(
      "friendships_pair_order_check",
      sql`${table.userLowId} < ${table.userHighId}`,
    ),
    check(
      "friendships_requester_check",
      sql`${table.requestedById} IN (${table.userLowId}, ${table.userHighId})`,
    ),
    check(
      "friendships_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined')`,
    ),
    check(
      "friendships_timestamps_check",
      sql`(${table.status} = 'pending' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NULL)
        OR (${table.status} = 'accepted' AND ${table.acceptedAt} IS NOT NULL AND ${table.declinedAt} IS NULL)
        OR (${table.status} = 'declined' AND ${table.acceptedAt} IS NULL AND ${table.declinedAt} IS NOT NULL)`,
    ),
  ],
);
