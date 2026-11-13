import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database, Executor } from "../db/client.ts";
import { friendships } from "../db/schema/friendships.ts";
import { users } from "../db/schema/users.ts";
import { ServiceUnavailableError } from "./auth-service.ts";

export type FriendUser = {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
};
export type FriendRequestInfo = FriendUser & {
  requestId: number;
  createdAt: string;
};
export type FriendsList = {
  friends: (FriendUser & { online: boolean })[];
  incoming: FriendRequestInfo[];
  outgoing: FriendRequestInfo[];
};
export type FriendRequestResult = FriendUser & {
  requestId: number;
  status: "pending" | "accepted";
};
export type FriendError =
  | "USER_NOT_FOUND"
  | "ALREADY_FRIENDS"
  | "REQUEST_PENDING"
  | "REQUEST_DECLINED"
  | "FRIEND_REQUEST_CONFLICT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "REQUEST_NOT_PENDING";
export type FriendMutation =
  | { ok: true; status: 200 | 201; result: FriendRequestResult }
  | { ok: false; code: FriendError };
export type FriendDecision =
  { ok: true; result: FriendRequestResult } | { ok: false; code: FriendError };
export type FriendRemoval = { ok: true } | { ok: false; code: "NOT_FOUND" };

const pair = (a: number, b: number) =>
  a < b ? { low: a, high: b } : { low: b, high: a };

const profileFields = {
  id: users.id,
  nickname: users.nickname,
  avatarUrl: users.avatarUrl,
};

/**
 * 친구 관계의 PostgreSQL 트랜잭션과 REST 조회를 제공합니다.
 *
 * @param db - 같은 트랜잭션 내에서 행 잠금과 상태 변경을 실행할 데이터베이스
 * @param isUserOnline - 인증 완료 WebSocket 연결을 조회하는 D의 동기 함수
 * @returns 친구 요청·목록·검색·수락·거절·삭제 기능
 *
 * @remarks
 * 온라인 여부의 진실 공급원은 D의 인증 연결 registry입니다. 함수를
 * 주입하지 않으면 수락된 친구가 있을 때 503으로 응답해, 임의의 false로
 * 온라인 사용자를 오프라인으로 표시하지 않습니다.
 */
export function createFriendService(
  db: Database,
  isUserOnline?: (userId: number) => boolean,
) {
  async function lockActivePair(executor: Executor, a: number, b: number) {
    // 탈퇴의 사용자 잠금보다 관계 잠금을 먼저 잡으면 수락과 탈퇴가 교착합니다.
    return executor
      .select(profileFields)
      .from(users)
      .where(and(inArray(users.id, [a, b]), isNull(users.deletedAt)))
      .orderBy(asc(users.id))
      .for("share");
  }

  function visible(
    profile: Pick<typeof users.$inferSelect, "id" | "nickname" | "avatarUrl">,
  ): FriendUser {
    return {
      userId: profile.id,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
    };
  }

  const forPair = (a: number, b: number) => {
    const { low, high } = pair(a, b);
    return and(
      eq(friendships.userLowId, low),
      eq(friendships.userHighId, high),
    );
  };

  /**
   * 친구 요청을 원자적으로 기록합니다.
   *
   * @remarks
   * 양쪽 활성 사용자 행을 ID 순서로 공유 잠근 뒤 관계를 잠가 탈퇴와 직렬화합니다.
   * 동일 쌍 UNIQUE 충돌 후에는 같은 트랜잭션에서 새 SELECT snapshot으로
   * 상태를 재검사합니다. 삭제 경합으로 다시 0행이 될 수 있어 INSERT 시도는
   * 최대 세 번으로 제한합니다. 거절자가 재요청하면 기존 행을 삭제하고 새
   * ID로 생성해 오래된 탭의 수락/거절이 새 요청에 작동하지 못하게 합니다.
   */
  async function requestFriend(
    actorId: number,
    otherId: number,
  ): Promise<FriendMutation> {
    return db.transaction(async (tx): Promise<FriendMutation> => {
      const profiles = await lockActivePair(tx, actorId, otherId);
      const target = profiles.find((profile) => profile.id === otherId);
      if (profiles.length !== 2 || !target)
        return { ok: false, code: "USER_NOT_FOUND" };
      const { low, high } = pair(actorId, otherId);
      const condition = forPair(actorId, otherId);

      const maxInsertAttempts = 3;
      for (let attempt = 0; attempt <= maxInsertAttempts; attempt += 1) {
        const [existing] = await tx
          .select()
          .from(friendships)
          .where(condition)
          .for("update");

        if (existing) {
          if (existing.status === "accepted")
            return { ok: false, code: "ALREADY_FRIENDS" };
          if (existing.status === "pending") {
            if (existing.requestedById === actorId)
              return { ok: false, code: "REQUEST_PENDING" };
            await tx
              .update(friendships)
              .set({
                status: "accepted",
                acceptedAt: new Date(),
                declinedAt: null,
              })
              .where(eq(friendships.id, existing.id));
            return {
              ok: true,
              status: 200,
              result: {
                ...visible(target),
                requestId: existing.id,
                status: "accepted",
              },
            };
          }
          if (existing.requestedById === actorId)
            return { ok: false, code: "REQUEST_DECLINED" };

          // The former recipient initiates a NEW request with a NEW id.
          await tx.delete(friendships).where(eq(friendships.id, existing.id));
        } else if (attempt === maxInsertAttempts) {
          break;
        }

        const insert = tx
          .insert(friendships)
          .values({ userLowId: low, userHighId: high, requestedById: actorId });
        const [inserted] = await (
          existing
            ? insert
            : insert.onConflictDoNothing({
                target: [friendships.userLowId, friendships.userHighId],
              })
        ).returning({ id: friendships.id });
        if (inserted)
          return {
            ok: true,
            status: 201,
            result: {
              ...visible(target),
              requestId: inserted.id,
              status: "pending",
            },
          };
        if (existing)
          throw new Error("Failed to replace the declined request.");
        // Competing INSERT and subsequent DELETE can leave the next SELECT empty.
      }
      return { ok: false, code: "FRIEND_REQUEST_CONFLICT" };
    });
  }

  /** 수락/거절은 활성 사용자 공유 잠금 후 관계를 FOR UPDATE로 잠그고 권한·상태를 재검증합니다. */
  async function decide(
    actorId: number,
    requestId: number,
    action: "accept" | "decline",
  ): Promise<FriendDecision> {
    return db.transaction(async (tx): Promise<FriendDecision> => {
      const condition = and(
        eq(friendships.id, requestId),
        or(
          eq(friendships.userLowId, actorId),
          eq(friendships.userHighId, actorId),
        ),
      );
      const [initial] = await tx.select().from(friendships).where(condition);
      if (!initial) return { ok: false, code: "NOT_FOUND" };
      const profiles = await lockActivePair(
        tx,
        initial.userLowId,
        initial.userHighId,
      );
      if (profiles.length !== 2) return { ok: false, code: "NOT_FOUND" };
      const [row] = await tx
        .select()
        .from(friendships)
        .where(condition)
        .for("update");
      if (!row) return { ok: false, code: "NOT_FOUND" };
      if (row.requestedById === actorId)
        return { ok: false, code: "FORBIDDEN" };
      if (row.status !== "pending")
        return { ok: false, code: "REQUEST_NOT_PENDING" };
      const sender = profiles.find(
        (profile) => profile.id === row.requestedById,
      );
      if (!sender) return { ok: false, code: "NOT_FOUND" };

      await tx
        .update(friendships)
        .set({
          status: action === "accept" ? "accepted" : "declined",
          acceptedAt: action === "accept" ? new Date() : null,
          declinedAt: action === "decline" ? new Date() : null,
        })
        .where(eq(friendships.id, requestId));
      return {
        ok: true,
        result: {
          ...visible(sender),
          requestId,
          status: action === "accept" ? "accepted" : "pending",
        },
      };
    });
  }

  /** 수락된 관계만 삭제합니다. declined 행은 재요청 차단을 위해 보존합니다. */
  async function removeFriend(
    actorId: number,
    otherId: number,
  ): Promise<FriendRemoval> {
    return db.transaction(async (tx): Promise<FriendRemoval> => {
      const [row] = await tx
        .select({ id: friendships.id, status: friendships.status })
        .from(friendships)
        .where(forPair(actorId, otherId))
        .for("update");
      if (!row || row.status !== "accepted")
        return { ok: false, code: "NOT_FOUND" };
      await tx.delete(friendships).where(eq(friendships.id, row.id));
      return { ok: true };
    });
  }

  /** 로그인 사용자의 친구, 받은 요청, 보낸 요청을 한 번에 조회합니다. */
  async function getFriends(actorId: number): Promise<FriendsList> {
    const relations = await db
      .select()
      .from(friendships)
      .where(
        or(
          eq(friendships.userLowId, actorId),
          eq(friendships.userHighId, actorId),
        ),
      )
      .orderBy(asc(friendships.id));
    const otherIds = relations.map((row) =>
      row.userLowId === actorId ? row.userHighId : row.userLowId,
    );
    const profiles = otherIds.length
      ? await db
          .select(profileFields)
          .from(users)
          .where(and(inArray(users.id, otherIds), isNull(users.deletedAt)))
      : [];
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    const response: FriendsList = { friends: [], incoming: [], outgoing: [] };
    for (const row of relations) {
      const otherId =
        row.userLowId === actorId ? row.userHighId : row.userLowId;
      const other = byId.get(otherId);
      if (!other) continue;
      const person = visible(other);
      if (row.status === "accepted") {
        if (!isUserOnline) throw new ServiceUnavailableError();
        response.friends.push({ ...person, online: isUserOnline(otherId) });
      } else if (row.status === "pending") {
        const item = {
          ...person,
          requestId: row.id,
          createdAt: row.createdAt.toISOString(),
        };
        if (row.requestedById === actorId) response.outgoing.push(item);
        else response.incoming.push(item);
      }
    }
    return response;
  }

  /** 닉네임 접두사 검색 결과는 계정의 공개 필드로 최대 20명만 제공합니다. */
  async function searchUsers(
    actorId: number,
    nickname: string,
  ): Promise<
    Array<{ id: number; nickname: string; avatarUrl: string | null }>
  > {
    // Compare in NFC like the nickname unique index, so legacy NFD nicknames match too.
    const prefix = nickname.trim().normalize("NFC");
    if (!prefix) return [];
    return db
      .select(profileFields)
      .from(users)
      .where(
        and(
          ne(users.id, actorId),
          isNull(users.deletedAt),
          sql`left(lower(normalize(${users.nickname}, NFC)), char_length(${prefix})) = lower(${prefix})`,
        ),
      )
      .orderBy(asc(users.nickname), asc(users.id))
      .limit(20);
  }

  /** D의 presence 이벤트를 수락된 친구에게만 전달할 때 사용하는 조회 함수입니다. */
  async function listAcceptedFriendIds(actorId: number): Promise<number[]> {
    const lowUser = alias(users, "low_user");
    const highUser = alias(users, "high_user");
    const rows = await db
      .select({
        low: friendships.userLowId,
        high: friendships.userHighId,
      })
      .from(friendships)
      .innerJoin(lowUser, eq(lowUser.id, friendships.userLowId))
      .innerJoin(highUser, eq(highUser.id, friendships.userHighId))
      .where(
        and(
          or(
            eq(friendships.userLowId, actorId),
            eq(friendships.userHighId, actorId),
          ),
          eq(friendships.status, "accepted"),
          isNull(lowUser.deletedAt),
          isNull(highUser.deletedAt),
        ),
      );
    return rows.map((row) => (row.low === actorId ? row.high : row.low));
  }

  return {
    requestFriend,
    decide,
    removeFriend,
    getFriends,
    searchUsers,
    listAcceptedFriendIds,
  };
}

export type FriendService = ReturnType<typeof createFriendService>;
