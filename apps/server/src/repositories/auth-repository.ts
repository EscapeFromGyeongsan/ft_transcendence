import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { refreshTokens, sessions, users } from "../db/schema/users.ts";
import { oauthAccounts } from "../db/schema/external-auth.ts";

export const publicUserColumns = {
  id: users.id,
  email: users.email,
  nickname: users.nickname,
  avatarUrl: users.avatarUrl,
  recordsPublic: users.recordsPublic,
  createdAt: users.createdAt,
};

/** 본인에게 돌려주는 계정 정보입니다. 비밀번호 해시는 포함하지 않습니다. */
export type PublicUser = {
  id: number;
  email: string;
  nickname: string;
  avatarUrl: string | null;
  recordsPublic: boolean;
  createdAt: Date;
};

/**
 * 계정을 만듭니다.
 *
 * @param values - `passwordHash`는 OAuth 전용 계정이면 `null`
 * @throws 이메일·닉네임 UNIQUE 위반(23505). 호출자가 제약 이름으로 구분합니다.
 */
export async function insertUser(
  db: Executor,
  values: { email: string; nickname: string; passwordHash: string | null },
): Promise<PublicUser> {
  const [user] = await db
    .insert(users)
    .values(values)
    .returning(publicUserColumns);
  return user;
}

/** 로그인 검사용으로 ID와 비밀번호 해시를 찾습니다. `email`은 호출자가 소문자로 맞춰 넘깁니다. */
export async function findUserCredentialsByEmail(db: Executor, email: string) {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));
  return user;
}

/** `GET /api/users/me`의 내 정보입니다. `hasPassword`는 비밀번호로 로그인할 수 있는 계정인지 나타냅니다. */
export type MeUser = PublicUser & {
  hasPassword: boolean;
  oauth42Linked: boolean;
};

export async function findUserById(
  db: Executor,
  id: number,
): Promise<MeUser | undefined> {
  const [user] = await db
    .select({
      ...publicUserColumns,
      hasPassword: sql<boolean>`${users.passwordHash} IS NOT NULL`,
      oauth42Linked: sql<boolean>`EXISTS (SELECT 1 FROM ${oauthAccounts} WHERE ${oauthAccounts.userId} = ${users.id} AND ${oauthAccounts.provider} = '42')`,
    })
    .from(users)
    .where(eq(users.id, id));
  return user;
}

/**
 * 탈퇴하지 않은 사용자 행을 `FOR SHARE`로 잠그고 있는지 확인합니다.
 *
 * @remarks 탈퇴는 같은 행을 `FOR UPDATE`로 잠그므로, 세션 생성과 탈퇴가 겹치면 한쪽이 끝날 때까지 기다립니다.
 */
export async function lockActiveUser(db: Executor, userId: number) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .for("share");
  return user !== undefined;
}

export async function insertSession(
  db: Executor,
  values: { userId: number; expiresAt: Date },
) {
  const [session] = await db
    .insert(sessions)
    .values(values)
    .returning({ id: sessions.id, expiresAt: sessions.expiresAt });
  return session;
}

/** 폐기되지 않았고 `now` 기준 만료 전인, 해당 사용자의 세션을 찾습니다. */
export async function findActiveSession(
  db: Executor,
  sessionId: string,
  userId: number,
  now: Date,
) {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    );
  return session;
}

/** 세션을 폐기합니다. 이미 폐기된 세션의 `revoked_at`은 바꾸지 않습니다. */
export async function revokeSession(
  db: Executor,
  sessionId: string,
  now: Date,
) {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function insertRefreshToken(
  db: Executor,
  values: { sessionId: string; tokenHash: string; expiresAt: Date },
) {
  await db.insert(refreshTokens).values(values);
}

/**
 * 토큰 해시로 refresh token과 그 세션을 찾고 토큰 행을 잠급니다(`FOR UPDATE`).
 *
 * @remarks
 * 트랜잭션 안에서 호출해야 합니다. 행 잠금으로 같은 토큰의 동시 refresh 두 개가 둘 다 회전하지 못합니다.
 */
export async function findRefreshTokenForUpdate(
  db: Executor,
  tokenHash: string,
) {
  const [row] = await db
    .select({
      id: refreshTokens.id,
      expiresAt: refreshTokens.expiresAt,
      usedAt: refreshTokens.usedAt,
      sessionId: sessions.id,
      userId: sessions.userId,
      sessionExpiresAt: sessions.expiresAt,
      sessionRevokedAt: sessions.revokedAt,
    })
    .from(refreshTokens)
    .innerJoin(sessions, eq(refreshTokens.sessionId, sessions.id))
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .for("update");
  return row;
}

export async function markRefreshTokenUsed(
  db: Executor,
  id: number,
  now: Date,
) {
  await db
    .update(refreshTokens)
    .set({ usedAt: now })
    .where(eq(refreshTokens.id, id));
}
