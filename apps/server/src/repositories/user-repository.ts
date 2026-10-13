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
