import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { oauthAccounts, oauthStates } from "../db/schema/external-auth.ts";

export async function insertState(
  db: Executor,
  values: {
    stateHash: string;
    provider: string;
    mode: "login" | "link";
    userId: number | null;
    sessionId: string | null;
    browserHash: string;
    expiresAt: Date;
  },
) {
  await db.insert(oauthStates).values(values);
}

/**
 * 쓰지 않았고 만료 전인 state를 한 UPDATE로 사용 처리합니다.
 *
 * @returns state의 mode·사용자·세션. 없음·만료·이미 사용·브라우저 불일치면 `undefined`
 *
 * @remarks
 * 원자적 갱신이라 callback(또는 재전송된 제공자 응답)은 최대 한 번만 받아들여집니다.
 * 흐름을 시작한 브라우저(`browser_hash` 일치)에서 온 요청만 통과합니다.
 */
export async function consumeState(
  db: Executor,
  stateHash: string,
  browserHash: string,
  provider: string,
) {
  const [row] = await db
    .update(oauthStates)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(oauthStates.stateHash, stateHash),
        eq(oauthStates.browserHash, browserHash),
        eq(oauthStates.provider, provider),
        isNull(oauthStates.usedAt),
        gt(oauthStates.expiresAt, sql`now()`),
      ),
    )
    .returning({
      mode: oauthStates.mode,
      userId: oauthStates.userId,
      sessionId: oauthStates.sessionId,
    });
  return row;
}

export async function findAccount(
  db: Executor,
  provider: string,
  providerUserId: string,
) {
  const [row] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerUserId, providerUserId),
      ),
    );
  return row;
}

/**
 * 외부 계정 연결을 저장합니다.
 *
 * @throws 이미 다른 계정에 연결된 제공자 사용자이거나, 이 계정에 같은 제공자 연결이 있으면 UNIQUE 위반(23505)
 */
export async function insertAccount(
  db: Executor,
  values: { userId: number; provider: string; providerUserId: string },
) {
  await db.insert(oauthAccounts).values(values);
}
