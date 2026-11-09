import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../db/client.ts";
import { gamePlayers, games } from "../db/schema/games.ts";
import { users } from "../db/schema/users.ts";

/**
 * 사용자의 게임 종류별 승·패·무 수를 셉니다.
 *
 * @remarks
 * `game_players.result`는 경기가 끝날 때 채워지므로 끝난 경기만 집계됩니다. 무효(void) 경기는 세지 않습니다.
 */
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

/**
 * 사용자의 끝난 경기 목록을 최신순(경기 ID 내림차순)으로 읽습니다.
 *
 * @param options - `before`는 이 경기 ID보다 오래된 것만(cursor), `limit`은 페이지 크기
 * @returns 최대 `limit + 1`행. 마지막 한 행은 다음 페이지가 있는지 판단용입니다.
 */
export function findFinishedMatches(
  db: Executor,
  userId: number,
  options: { gameType?: string; before?: number; limit: number },
) {
  return (
    db
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
      // One extra row tells whether an older page exists.
      .limit(options.limit + 1)
  );
}

/**
 * 게임 종류별 리더보드 상위 `limit`명을 읽습니다.
 *
 * @remarks
 * DEC-08 순서: 승수 내림차순, 승률 내림차순, 사용자 ID 오름차순. 무효 경기는 세지 않고,
 * 집계되는 경기가 한 판 이상인 사용자만 나옵니다.
 */
export function findLeaderboard(db: Executor, gameType: string, limit: number) {
  const wins = sql<number>`count(*) filter (where ${gamePlayers.result} = 'win')::int`;
  const played = sql<number>`count(*) filter (where ${gamePlayers.result} in ('win', 'loss', 'draw'))::int`;
  const winRate = sql<number>`(${wins})::float8 / nullif(${played}, 0)`;
  return db
    .select({
      rank: sql<number>`row_number() over (order by ${wins} desc, ${winRate} desc nulls last, ${users.id})::int`,
      userId: users.id,
      nickname: users.nickname,
      wins,
      played,
      winRate: sql<number>`coalesce(${winRate}, 0)`,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(games.gameType, gameType))
    .groupBy(users.id)
    .having(sql`${played} > 0`)
    .orderBy(desc(wins), sql`${winRate} desc nulls last`, users.id)
    .limit(limit);
}

/** Read access policy inside a transaction and hold it until the records are read. */
export async function findRecordsAccess(db: Executor, userId: number) {
  const [row] = await db
    .select({ recordsPublic: users.recordsPublic })
    .from(users)
    .where(eq(users.id, userId))
    .for("share");
  return row;
}
