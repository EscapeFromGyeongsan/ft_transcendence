import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database, Executor } from "../db/client.ts";
import { chatMessages } from "../db/schema/chat-messages.ts";
import { friendships } from "../db/schema/friendships.ts";
import { users } from "../db/schema/users.ts";

const messageFields = {
  id: chatMessages.id,
  senderId: chatMessages.senderId,
  text: chatMessages.text,
  createdAt: chatMessages.createdAt,
};
const pageSize = 50;

function toMessage(
  row: Pick<typeof chatMessages.$inferSelect, keyof typeof messageFields>,
) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** 현재 수락된 친구 사이의 대화만 조회·기록합니다. */
export function createChatService(db: Database) {
  async function lockFriendship(
    tx: Executor,
    userId: number,
    peerId: number,
    lock: "share" | "update",
  ) {
    if (userId === peerId) return undefined;
    // 친구 서비스와 같은 순서로 활성 사용자 행을 먼저 잠가 탈퇴와 직렬화합니다.
    const pair = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [userId, peerId]), isNull(users.deletedAt)))
      .orderBy(asc(users.id))
      .for("share");
    if (pair.length !== 2) return undefined;
    const [relation] = await tx
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.userLowId, pair[0].id),
          eq(friendships.userHighId, pair[1].id),
          eq(friendships.status, "accepted"),
        ),
      )
      .for(lock);
    return relation;
  }

  return {
    async list(userId: number) {
      const peerId = sql<number>`case when ${friendships.userLowId} = ${userId} then ${friendships.userHighId} else ${friendships.userLowId} end`;
      const latest = db
        .select({ id: chatMessages.id, createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(eq(chatMessages.friendshipId, friendships.id))
        .orderBy(desc(chatMessages.id))
        .limit(1)
        .as("latest_chat");
      const rows = await db
        .select({
          friendshipId: friendships.id,
          userId: users.id,
          nickname: users.nickname,
          lastMessageAt: latest.createdAt,
        })
        .from(friendships)
        .innerJoin(users, eq(users.id, peerId))
        .leftJoinLateral(latest, sql`true`)
        .where(
          and(
            or(
              eq(friendships.userLowId, userId),
              eq(friendships.userHighId, userId),
            ),
            eq(friendships.status, "accepted"),
            isNull(users.deletedAt),
          ),
        )
        .orderBy(
          sql`${latest.id} DESC NULLS LAST`,
          asc(users.nickname),
          asc(users.id),
        );
      return rows.map((row) => ({
        ...row,
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      }));
    },

    async history(userId: number, peerId: number, before?: number) {
      return db.transaction(async (tx) => {
        const relation = await lockFriendship(tx, userId, peerId, "share");
        if (!relation) return null;
        const rows = await tx
          .select(messageFields)
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.friendshipId, relation.id),
              before === undefined ? undefined : lt(chatMessages.id, before),
            ),
          )
          .orderBy(desc(chatMessages.id))
          .limit(pageSize + 1);
        const messages = rows.slice(0, pageSize).reverse();
        return {
          messages: messages.map(toMessage),
          nextBefore: rows.length > pageSize ? messages[0].id : null,
        };
      });
    },

    async send(userId: number, peerId: number, text: string, clientId: string) {
      return db.transaction(async (tx) => {
        // 같은 대화의 삽입을 직렬화해 페이지 커서와 저장 순서를 맞춥니다.
        const relation = await lockFriendship(tx, userId, peerId, "update");
        if (!relation) return null;
        const [inserted] = await tx
          .insert(chatMessages)
          .values({
            friendshipId: relation.id,
            senderId: userId,
            text,
            clientId,
          })
          .onConflictDoNothing({
            target: [
              chatMessages.friendshipId,
              chatMessages.senderId,
              chatMessages.clientId,
            ],
          })
          .returning(messageFields);
        if (inserted) return { message: toMessage(inserted), created: true };
        const [previous] = await tx
          .select(messageFields)
          .from(chatMessages)
          .where(
            and(
              eq(chatMessages.friendshipId, relation.id),
              eq(chatMessages.senderId, userId),
              eq(chatMessages.clientId, clientId),
            ),
          );
        return { message: toMessage(previous), created: false };
      });
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
