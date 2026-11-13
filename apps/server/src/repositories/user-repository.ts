import { and, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { users } from "../db/schema/users.ts";
import type { PublicUser } from "./auth-repository.ts";

/**
 * 활성 계정의 닉네임을 바꿉니다.
 *
 * @returns 바뀐 계정 정보. 사용자가 없거나 탈퇴했으면 `undefined`
 * @throws 닉네임 UNIQUE 위반(23505)
 */
export async function updateNickname(
  db: Executor,
  userId: number,
  nickname: string,
): Promise<PublicUser | undefined> {
  const [user] = await db
    .update(users)
    .set({ nickname, updatedAt: sql`now()` })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning({
      id: users.id,
      email: users.email,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    });
  return user;
}

/** 다른 사용자에게 보여도 되는 프로필 필드만 읽습니다. 이메일은 본인에게만 공개하므로 포함하지 않습니다. 탈퇴한 사용자는 프로필이 없습니다. */
export async function findProfile(db: Executor, userId: number) {
  const [profile] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  return profile;
}

/**
 * 활성 사용자의 현재 아바타 URL을 읽고 행을 잠급니다(`FOR UPDATE`).
 *
 * @returns 사용자가 없거나 탈퇴했으면 `undefined`
 *
 * @remarks
 * 아바타 변경끼리와 탈퇴를 직렬화합니다. 잠금을 기다리는 동안 탈퇴했으면 행을 반환하지 않습니다.
 * 트랜잭션 안에서 호출해야 합니다.
 */
export async function findAvatarForUpdate(db: Executor, userId: number) {
  const [user] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .for("update");
  return user;
}

/**
 * 활성 사용자의 아바타 URL을 바꿉니다. `null`이면 아바타를 지웁니다.
 *
 * @returns 바뀐 계정 정보. 사용자가 없거나 탈퇴했으면 `undefined`
 */
export async function updateAvatarUrl(
  db: Executor,
  userId: number,
  avatarUrl: string | null,
): Promise<PublicUser | undefined> {
  const [user] = await db
    .update(users)
    .set({ avatarUrl, updatedAt: sql`now()` })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning({
      id: users.id,
      email: users.email,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    });
  return user;
}
