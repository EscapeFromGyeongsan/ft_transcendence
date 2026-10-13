import { and, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import {
  twoFactorChallenges,
  twoFactorRecoveryCodes,
  twoFactorSecrets,
} from "../db/schema/external-auth.ts";

export async function findSecret(db: Executor, userId: number, lock = false) {
  const query = db
    .select()
    .from(twoFactorSecrets)
    .where(eq(twoFactorSecrets.userId, userId));
  const [row] = lock ? await query.for("update") : await query;
  return row;
}

export async function isEnabled(db: Executor, userId: number) {
  const row = await findSecret(db, userId);
  return Boolean(row?.enabledAt);
}

// Starts (or restarts) setup with a new, not yet confirmed secret.
export async function savePendingSecret(
  db: Executor,
  userId: number,
  secretEncrypted: string,
) {
  await db
    .insert(twoFactorSecrets)
    .values({ userId, secretEncrypted })
    .onConflictDoUpdate({
      target: twoFactorSecrets.userId,
      set: { secretEncrypted, enabledAt: null, lastUsedStep: null },
    });
}

export async function enableSecret(db: Executor, userId: number, step: number) {
  await db
    .update(twoFactorSecrets)
    .set({ enabledAt: sql`now()`, lastUsedStep: step })
    .where(eq(twoFactorSecrets.userId, userId));
}

export async function setLastUsedStep(
  db: Executor,
  userId: number,
  step: number,
) {
  await db
    .update(twoFactorSecrets)
    .set({ lastUsedStep: step })
    .where(eq(twoFactorSecrets.userId, userId));
}

export async function deleteTwoFactor(db: Executor, userId: number) {
  await db.delete(twoFactorSecrets).where(eq(twoFactorSecrets.userId, userId));
  await db
    .delete(twoFactorRecoveryCodes)
    .where(eq(twoFactorRecoveryCodes.userId, userId));
}

export async function replaceRecoveryCodes(
  db: Executor,
  userId: number,
  codeHashes: string[],
) {
  await db
    .delete(twoFactorRecoveryCodes)
    .where(eq(twoFactorRecoveryCodes.userId, userId));
  await db
    .insert(twoFactorRecoveryCodes)
    .values(codeHashes.map((codeHash) => ({ userId, codeHash })));
}

// Marks an unused recovery code as used. Returns false if none matched.
export async function consumeRecoveryCode(
  db: Executor,
  userId: number,
  codeHash: string,
) {
  const rows = await db
    .update(twoFactorRecoveryCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        eq(twoFactorRecoveryCodes.codeHash, codeHash),
        isNull(twoFactorRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: twoFactorRecoveryCodes.id });
  return rows.length > 0;
}

export async function insertChallenge(
  db: Executor,
  values: { userId: number; tokenHash: string; expiresAt: Date },
) {
  await db.insert(twoFactorChallenges).values(values);
}

export async function findChallengeForUpdate(db: Executor, tokenHash: string) {
  const [row] = await db
    .select()
    .from(twoFactorChallenges)
    .where(eq(twoFactorChallenges.tokenHash, tokenHash))
    .for("update");
  return row;
}

export async function updateChallenge(
  db: Executor,
  id: string,
  values: { usedAt?: Date; failedAttempts?: number },
) {
  await db
    .update(twoFactorChallenges)
    .set(values)
    .where(eq(twoFactorChallenges.id, id));
}
