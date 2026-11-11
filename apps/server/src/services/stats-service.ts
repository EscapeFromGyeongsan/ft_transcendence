import type { Database, Executor } from "../db/client.ts";
import * as repo from "../repositories/stats-repository.ts";

const PROGRESS_TARGET = 10;

/** 인증된 조회자가 다른 사용자의 비공개 전적을 요청했을 때 발생합니다. */
export class RecordsPrivateError extends Error {
  constructor() {
    super("This user's records are private.");
    this.name = "RecordsPrivateError";
  }
}

/** 전적 통계·경기 기록·리더보드 조회 서비스를 만듭니다. 모두 읽기 전용입니다. */
export function createStatsService(db: Database) {
  // The shared user-row lock serializes the permission check/read with privacy
  // updates. Callers must pass the viewer from their authenticated session.
  function readRecords<T>(
    userId: number,
    viewerId: number,
    read: (tx: Executor) => Promise<T>,
  ): Promise<T | undefined> {
    return db.transaction(async (tx) => {
      const policy = await repo.findRecordsAccess(tx, userId);
      if (!policy) return undefined;
      if (viewerId !== userId && !policy.recordsPublic) {
        throw new RecordsPrivateError();
      }
      return read(tx);
    });
  }

  return {
    /**
     * 사용자의 게임 종류별 통계와 DEC-08 업적·진행도를 계산합니다.
     *
     * @param viewerId - 인증된 세션에서 확인한 조회자 ID
     * @returns 사용자가 없으면 `undefined`
     *
     * @remarks 본인 외에는 공개 전적만 조회할 수 있습니다. 권한 검사와 조회는 같은 트랜잭션에서 수행하며 무효 경기는 `played`와 승률에서 제외합니다.
     * @throws {@link RecordsPrivateError} 타인의 비공개 전적 조회
     */
    getStats(userId: number, gameType: string, viewerId: number) {
      return readRecords(userId, viewerId, async (tx) => {
        const { wins, losses, draws } = await repo.countResults(
          tx,
          userId,
          gameType,
        );
        const played = wins + losses + draws;
        return {
          userId,
          gameType,
          wins,
          losses,
          draws,
          played,
          winRate: played === 0 ? 0 : wins / played,
          // DEC-08: first-win achievement and 10-match participation progress,
          // both per game type and derived from counted matches.
          achievements: { firstWin: wins > 0 },
          progress: {
            current: Math.min(played, PROGRESS_TARGET),
            target: PROGRESS_TARGET,
          },
        };
      });
    },

    /**
     * 사용자의 끝난 경기 기록을 최신순으로 한 페이지 읽습니다.
     *
     * @param viewerId - 인증된 세션에서 확인한 조회자 ID
     * @returns 사용자가 없으면 `undefined`. `nextBefore`를 다음 호출의 `before`로 넘기면 더 오래된 페이지를 읽습니다(없으면 `null`).
     * @remarks 본인은 비공개 전적도 조회할 수 있고, 다른 사용자는 공개 전적만 조회할 수 있습니다. 권한 검사와 조회는 같은 트랜잭션에서 수행합니다.
     * @throws {@link RecordsPrivateError} 타인의 비공개 전적 조회
     */
    getMatches(
      userId: number,
      options: { gameType?: string; before?: number; limit: number },
      viewerId: number,
    ) {
      return readRecords(userId, viewerId, async (tx) => {
        const found = await repo.findFinishedMatches(tx, userId, options);
        const rows = found.slice(0, options.limit);
        return {
          matches: rows.map((row) => ({
            matchId: row.matchId,
            gameType: row.gameType,
            result: row.result,
            reason: row.reason,
            seat: row.seat,
            opponent: { id: row.opponentId, nickname: row.opponentNickname },
            finishedAt: row.finishedAt,
          })),
          // Pass as `before` to get the next (older) page.
          nextBefore:
            found.length > options.limit ? rows[rows.length - 1].matchId : null,
        };
      });
    },

    getLeaderboard(gameType: string, limit: number) {
      return repo.findLeaderboard(db, gameType, limit);
    },
  };
}

export type StatsService = ReturnType<typeof createStatsService>;
