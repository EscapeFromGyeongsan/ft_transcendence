import { and, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import {
  twoFactorChallenges,
  twoFactorRecoveryCodes,
  twoFactorSecrets,
} from "../db/schema/external-auth.ts";

/**
 * 사용자의 TOTP secret 행을 읽습니다.
 *
 * @param lock - `true`면 `FOR UPDATE`로 잠급니다. 트랜잭션 안에서만 의미가 있습니다.
 */
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

/**
 * 확인 전의 새 secret으로 설정을 시작(또는 다시 시작)합니다.
 *
 * @returns 저장했으면 `true`, 이미 2FA가 켜져 있으면 `false`
 *
 * @remarks
 * 켜진 secret은 덮어쓰지 않습니다. 이 요청이 행을 보지 못한 사이에 병렬 setup+enable이 먼저 끝나도 마찬가지입니다(`ON CONFLICT ... WHERE enabled_at IS NULL`).
 */
export async function savePendingSecret(
  db: Executor,
  userId: number,
  secretEncrypted: string,
) {
  const rows = await db
    .insert(twoFactorSecrets)
    .values({ userId, secretEncrypted })
    .onConflictDoUpdate({
      target: twoFactorSecrets.userId,
      set: { secretEncrypted, enabledAt: null, lastUsedStep: null },
      setWhere: isNull(twoFactorSecrets.enabledAt),
    })
    .returning({ userId: twoFactorSecrets.userId });
  return rows.length > 0;
}

/** 2FA를 켜고, 확인에 쓴 step을 마지막 사용 step으로 저장해 같은 코드의 재사용을 막습니다. */
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

/** secret과 복구 코드를 모두 지웁니다. 두 DELETE를 한 번에 반영하려면 트랜잭션 안에서 호출합니다. */
export async function deleteTwoFactor(db: Executor, userId: number) {
  await db.delete(twoFactorSecrets).where(eq(twoFactorSecrets.userId, userId));
  await db
    .delete(twoFactorRecoveryCodes)
    .where(eq(twoFactorRecoveryCodes.userId, userId));
}

/** 기존 복구 코드를 지우고 새 코드 해시로 바꿉니다. 트랜잭션 안에서 호출해야 중간 상태가 보이지 않습니다. */
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

/**
 * 쓰지 않은 복구 코드를 사용 처리합니다.
 *
 * @returns 처리했으면 `true`, 일치하는 미사용 코드가 없으면 `false`
 *
 * @remarks 한 UPDATE로 확인과 사용 처리를 하므로 같은 코드는 한 번만 통과합니다.
 */
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

/** 토큰 해시로 2FA challenge를 찾고 행을 잠급니다(`FOR UPDATE`). 트랜잭션 안에서 호출합니다. */
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
