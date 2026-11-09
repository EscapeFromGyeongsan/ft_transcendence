import { eq, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { users } from "../db/schema/users.ts";
import { publicUserColumns, type PublicUser } from "./auth-repository.ts";

/** Fields a signed-in user may change on their own profile. */
export interface ProfileUpdate {
  nickname?: string;
  recordsPublic?: boolean;
}

/**
 * 전달된 프로필 필드만 하나의 UPDATE로 저장합니다. 닉네임 충돌 시 설정도 저장되지 않습니다.
 *
 * @returns 바뀐 계정 정보. 사용자가 없으면 `undefined`
 * @throws 닉네임 UNIQUE 위반(23505)
 */
export async function updateProfile(
  db: Executor,
  userId: number,
  changes: ProfileUpdate,
): Promise<PublicUser | undefined> {
  const [user] = await db
    .update(users)
    .set({ ...changes, updatedAt: sql`now()` })
    .where(eq(users.id, userId))
    .returning(publicUserColumns);
  return user;
}

/** 다른 사용자에게 보여도 되는 프로필 필드만 읽습니다. 이메일은 본인에게만 공개하므로 포함하지 않습니다. */
export async function findProfile(db: Executor, userId: number) {
  const [profile] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId));
  return profile;
}

// Locks the user row so concurrent avatar changes see each other's file.
export async function findAvatarForUpdate(db: Executor, userId: number) {
  const [user] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  return user;
}

export async function updateAvatarUrl(
  db: Executor,
  userId: number,
  avatarUrl: string | null,
): Promise<PublicUser | undefined> {
  const [user] = await db
    .update(users)
    .set({ avatarUrl, updatedAt: sql`now()` })
    .where(eq(users.id, userId))
    .returning(publicUserColumns);
  return user;
}
