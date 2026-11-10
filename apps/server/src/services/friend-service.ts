import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Database, Executor } from "../db/client.ts";
import { friendships } from "../db/schema/friendships.ts";
import { users } from "../db/schema/users.ts";

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
  | { ok: true; result: FriendRequestResult }
  | { ok: false; code: FriendError };
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
 * 온라인 여부의 진실 공급원은 D의 연결 registry입니다. D가 연결되기 전에는
 * 함수가 전달되지 않으므로 false를 반환하며, 실시간 상태 기능은 미통합입니다.
 */
export function createFriendService(
  db: Database,
  isUserOnline: (userId: number) => boolean = () => false,
) {
  async function findUser(executor: Executor, userId: number) {
    const [profile] = await executor
      .select(profileFields)
      .from(users)
      .where(eq(users.id, userId));
    return profile;
  }

  function visible(profile: NonNullable<Awaited<ReturnType<typeof findUser>>>): FriendUser {
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
      const target = await findUser(tx, otherId);
      if (!target) return { ok: false, code: "USER_NOT_FOUND" };
      const { low, high } = pair(actorId, otherId);
      const condition = forPair(actorId, otherId);

      for (let attempt = 0; attempt < 3; attempt += 1) {
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
              .set({ status: "accepted", acceptedAt: new Date(), declinedAt: null })
              .where(eq(friendships.id, existing.id));
            return {
              ok: true,
              status: 200,
              result: { ...visible(target), requestId: existing.id, status: "accepted" },
            };
          }
          if (existing.requestedById === actorId)
            return { ok: false, code: "REQUEST_DECLINED" };

          // The former recipient initiates a NEW request with a NEW id.
          await tx.delete(friendships).where(eq(friendships.id, existing.id));
        }

        const [inserted] = await tx
          .insert(friendships)
          .values({ userLowId: low, userHighId: high, requestedById: actorId })
          .onConflictDoNothing({ target: [friendships.userLowId, friendships.userHighId] })
          .returning({ id: friendships.id });
        if (inserted)
          return {
            ok: true,
            status: 201,
            result: { ...visible(target), requestId: inserted.id, status: "pending" },
          };
        // Competing INSERT and subsequent DELETE can leave the next SELECT empty.
      }
      return { ok: false, code: "FRIEND_REQUEST_CONFLICT" };
    });
  }

  /** 수락/거절은 동일 행을 FOR UPDATE로 잠근 뒤 요청 수신자 권한을 재검증합니다. */
  async function decide(
    actorId: number,
    requestId: number,
    action: "accept" | "decline",
  ): Promise<FriendDecision> {
    return db.transaction(async (tx): Promise<FriendDecision> => {
      const [row] = await tx
        .select()
        .from(friendships)
        .where(eq(friendships.id, requestId))
        .for("update");
      if (!row) return { ok: false, code: "NOT_FOUND" };
      const recipientId =
        row.requestedById === row.userLowId ? row.userHighId : row.userLowId;
      if (recipientId !== actorId)
        return { ok: false, code: "FORBIDDEN" };
      if (row.status !== "pending")
        return { ok: false, code: "REQUEST_NOT_PENDING" };
      const sender = await findUser(tx, row.requestedById);
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
        result: { ...visible(sender), requestId, status: action === "accept" ? "accepted" : "pending" },
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
      .where(or(eq(friendships.userLowId, actorId), eq(friendships.userHighId, actorId)))
      .orderBy(asc(friendships.id));
    const otherIds = relations.map((row) =>
      row.userLowId === actorId ? row.userHighId : row.userLowId,
    );
    const profiles = otherIds.length
      ? await db.select(profileFields).from(users).where(inArray(users.id, otherIds))
      : [];
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    const response: FriendsList = { friends: [], incoming: [], outgoing: [] };
    for (const row of relations) {
      const otherId = row.userLowId === actorId ? row.userHighId : row.userLowId;
      const other = byId.get(otherId);
      if (!other) continue;
      const person = visible(other);
      if (row.status === "accepted") {
        response.friends.push({ ...person, online: isUserOnline(otherId) });
      } else if (row.status === "pending") {
        const item = { ...person, requestId: row.id, createdAt: row.createdAt.toISOString() };
        if (row.requestedById === actorId) response.outgoing.push(item);
        else response.incoming.push(item);
      }
    }
    return response;
  }

  /** 닉네임 접두사 검색 결과는 계정의 공개 필드로 최대 20명만 제공합니다. */
  async function searchUsers(actorId: number, nickname: string): Promise<Array<{ id: number; nickname: string; avatarUrl: string | null }>> {
    const prefix = nickname.trim();
    if (!prefix) return [];
    return db.select(profileFields)
      .from(users)
      .where(and(
        ne(users.id, actorId),
        sql`left(lower(${users.nickname}), char_length(${prefix})) = lower(${prefix})`,
      ))
      .orderBy(asc(users.nickname), asc(users.id))
      .limit(20);
  }

  /** D의 presence 이벤트를 수락된 친구에게만 전달할 때 사용하는 조회 함수입니다. */
  async function listAcceptedFriendIds(actorId: number): Promise<number[]> {
    const rows = await db.select({
      low: friendships.userLowId,
      high: friendships.userHighId,
    }).from(friendships).where(and(
      or(eq(friendships.userLowId, actorId), eq(friendships.userHighId, actorId)),
      eq(friendships.status, "accepted"),
    ));
    return rows.map((row) => row.low === actorId ? row.high : row.low);
  }

  return { requestFriend, decide, removeFriend, getFriends, searchUsers, listAcceptedFriendIds };
}

export type FriendService = ReturnType<typeof createFriendService>;
