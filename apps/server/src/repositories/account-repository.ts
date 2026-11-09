import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import {
  oauthAccounts,
  oauthStates,
  twoFactorChallenges,
  twoFactorRecoveryCodes,
  twoFactorSecrets,
} from "../db/schema/external-auth.ts";
import { gamePlayers, games } from "../db/schema/games.ts";
import { refreshTokens, sessions, users } from "../db/schema/users.ts";

/** 탈퇴하지 않은 사용자 행을 잠그고 읽습니다. 탈퇴가 한 번만 실행되고, 그 사이 프로필 변경이 끼어들지 않습니다. */
export async function findActiveUserForUpdate(db: Executor, userId: number) {
  const [user] = await db
    .select({ passwordHash: users.passwordHash, avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .for("update");
  return user;
}

/** 세션이 만들어진 시각(로그인 시각)을 읽습니다. */
export async function findSessionCreatedAt(db: Executor, sessionId: string) {
  const [session] = await db
    .select({ createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return session?.createdAt;
}

/** 사용자가 끝나지 않은 경기(`waiting`·`playing`·`paused`)에 참가 중인지 확인합니다. */
export async function hasUnfinishedMatch(db: Executor, userId: number) {
  const [row] = await db
    .select({ id: games.id })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(
      and(
        eq(gamePlayers.userId, userId),
        inArray(games.status, ["waiting", "playing", "paused"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * 탈퇴 처리: 개인정보와 로그인 수단을 지우고 모든 세션을 폐기합니다(DEC-09).
 *
 * @remarks
 * 사용자 행은 남겨 `games`·`game_players`·`moves`의 참조를 유지합니다. 이메일·닉네임은
 * `deleted:<id>`로 바꿉니다. 검증 규칙이 `:`를 허용하지 않아 실제 계정과 겹치지 않고,
 * 원래 이메일·닉네임은 새 계정이 다시 쓸 수 있습니다.
 */
export async function anonymizeUser(db: Executor, userId: number, now: Date) {
  const sessionIds = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  await db
    .delete(refreshTokens)
    .where(inArray(refreshTokens.sessionId, sessionIds));
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  await db.delete(oauthAccounts).where(eq(oauthAccounts.userId, userId));
  await db.delete(oauthStates).where(eq(oauthStates.userId, userId));
  await db.delete(twoFactorSecrets).where(eq(twoFactorSecrets.userId, userId));
  await db
    .delete(twoFactorRecoveryCodes)
    .where(eq(twoFactorRecoveryCodes.userId, userId));
  await db
    .delete(twoFactorChallenges)
    .where(eq(twoFactorChallenges.userId, userId));
  await db
    .update(users)
    .set({
      email: `deleted:${userId}`,
      nickname: `deleted:${userId}`,
      passwordHash: null,
      avatarUrl: null,
      deletedAt: now,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId));
}
