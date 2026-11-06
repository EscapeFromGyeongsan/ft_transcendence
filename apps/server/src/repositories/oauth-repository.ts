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

// Atomically marks an unused, unexpired state as used, so a callback
// (or a replayed provider response) is accepted at most once, and only from
// the browser that started the flow (matching browser_hash).
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

export async function insertAccount(
  db: Executor,
  values: { userId: number; provider: string; providerUserId: string },
) {
  await db.insert(oauthAccounts).values(values);
}
