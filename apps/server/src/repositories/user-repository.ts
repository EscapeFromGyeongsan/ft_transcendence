import { eq, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { users } from "../db/schema/users.ts";
import type { PublicUser } from "./auth-repository.ts";

export async function updateNickname(
  db: Executor,
  userId: number,
  nickname: string,
): Promise<PublicUser | undefined> {
  const [user] = await db
    .update(users)
    .set({ nickname, updatedAt: sql`now()` })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    });
  return user;
}

// Fields other users may see. Email stays private to the owner.
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
    .returning({
      id: users.id,
      email: users.email,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    });
  return user;
}
