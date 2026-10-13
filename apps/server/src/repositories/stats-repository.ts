import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../db/client.ts";
import { gamePlayers, games } from "../db/schema/games.ts";
import { users } from "../db/schema/users.ts";

// Counts come from finished matches only (game_players.result is set at
// finish). Void matches are excluded from played/win rate.
export async function countResults(
  db: Executor,
  userId: number,
  gameType: string,
) {
  const [row] = await db
    .select({
      wins: sql<number>`count(*) filter (where ${gamePlayers.result} = 'win')::int`,
      losses: sql<number>`count(*) filter (where ${gamePlayers.result} = 'loss')::int`,
      draws: sql<number>`count(*) filter (where ${gamePlayers.result} = 'draw')::int`,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(and(eq(gamePlayers.userId, userId), eq(games.gameType, gameType)));
  return row;
}

const opponent = alias(gamePlayers, "opponent");

export function findFinishedMatches(
  db: Executor,
  userId: number,
  options: { gameType?: string; before?: number; limit: number },
) {
  return db
    .select({
      matchId: games.id,
      gameType: games.gameType,
      result: gamePlayers.result,
      reason: games.resultReason,
      seat: gamePlayers.seat,
      opponentId: users.id,
      opponentNickname: users.nickname,
      finishedAt: games.finishedAt,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(
      opponent,
      and(eq(opponent.gameId, games.id), ne(opponent.userId, userId)),
    )
    .innerJoin(users, eq(users.id, opponent.userId))
    .where(
      and(
        eq(gamePlayers.userId, userId),
        eq(games.status, "finished"),
        options.gameType ? eq(games.gameType, options.gameType) : undefined,
        options.before ? lt(games.id, options.before) : undefined,
      ),
    )
    .orderBy(desc(games.id))
    .limit(options.limit);
}

export function findLeaderboard(db: Executor, gameType: string, limit: number) {
  const wins = sql<number>`count(*)::int`;
  return db
    .select({
      rank: sql<number>`rank() over (order by count(*) desc)::int`,
      userId: users.id,
      nickname: users.nickname,
      wins,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(and(eq(gamePlayers.result, "win"), eq(games.gameType, gameType)))
    .groupBy(users.id)
    .orderBy(desc(wins), users.id)
    .limit(limit);
}

export async function userExists(db: Executor, userId: number) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId));
  return Boolean(row);
}
