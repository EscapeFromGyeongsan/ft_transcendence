import { and, eq, gt, isNull } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { refreshTokens, sessions, users } from "../db/schema/users.ts";

const publicUserColumns = {
  id: users.id,
  email: users.email,
  nickname: users.nickname,
  avatarUrl: users.avatarUrl,
  createdAt: users.createdAt,
};

export type PublicUser = {
  id: number;
  email: string;
  nickname: string;
  avatarUrl: string | null;
  createdAt: Date;
};

export async function insertUser(
  db: Executor,
  values: { email: string; nickname: string; passwordHash: string },
): Promise<PublicUser> {
  const [user] = await db
    .insert(users)
    .values(values)
    .returning(publicUserColumns);
  return user;
}

export async function findUserCredentialsByEmail(db: Executor, email: string) {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));
  return user;
}

export async function findUserById(
  db: Executor,
  id: number,
): Promise<PublicUser | undefined> {
  const [user] = await db
    .select(publicUserColumns)
    .from(users)
    .where(eq(users.id, id));
  return user;
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

// Locks the token row so two parallel refreshes cannot both rotate it.
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
