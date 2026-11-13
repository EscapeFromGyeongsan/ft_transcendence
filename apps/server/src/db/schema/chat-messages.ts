import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { friendships } from "./friendships.ts";
import { users } from "./users.ts";

/** 수락된 친구 관계에 속한 채팅 메시지입니다. 관계 삭제 시 메시지도 삭제합니다. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    friendshipId: bigint("friendship_id", { mode: "number" })
      .notNull()
      .references(() => friendships.id, { onDelete: "cascade" }),
    senderId: bigint("sender_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("chat_messages_friendship_id_idx").on(table.friendshipId, table.id),
    index("chat_messages_sender_id_idx").on(table.senderId),
    unique("chat_messages_client_id_unique").on(
      table.friendshipId,
      table.senderId,
      table.clientId,
    ),
    check(
      "chat_messages_text_length_check",
      sql`char_length(${table.text}) BETWEEN 1 AND 1000`,
    ),
  ],
);
