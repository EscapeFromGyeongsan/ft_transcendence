import type { Database } from "../db/client.ts";
import * as repo from "../repositories/stats-repository.ts";

const PROGRESS_TARGET = 10;

/** 전적 통계·경기 기록·리더보드 조회 서비스를 만듭니다. 모두 읽기 전용입니다. */
export function createStatsService(db: Database) {
  return {
    /**
     * 사용자의 게임 종류별 통계와 DEC-08 업적·진행도를 계산합니다.
     *
     * @returns 사용자가 없으면 `undefined`
     *
     * @remarks 무효 경기는 `played`와 승률에 들어가지 않습니다.
     */
    async getStats(userId: number, gameType: string) {
      if (!(await repo.userExists(db, userId))) return undefined;
      const { wins, losses, draws } = await repo.countResults(
        db,
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
    },

    /**
     * 사용자의 끝난 경기 기록을 최신순으로 한 페이지 읽습니다.
     *
     * @returns 사용자가 없으면 `undefined`. `nextBefore`를 다음 호출의 `before`로 넘기면 더 오래된 페이지를 읽습니다(없으면 `null`).
     */
    async getMatches(
      userId: number,
      options: { gameType?: string; before?: number; limit: number },
    ) {
      if (!(await repo.userExists(db, userId))) return undefined;
      const found = await repo.findFinishedMatches(db, userId, options);
      const rows = found.slice(0, options.limit);
      return {
        matches: rows.map((row) => ({
          matchId: row.matchId,
          gameType: row.gameType,
          result: row.result,
          reason: row.reason,
          seat: row.seat,
          opponent: {
            id: row.opponentId,
            nickname: row.opponentNickname,
            deleted: row.opponentDeleted,
          },
          finishedAt: row.finishedAt,
        })),
        // Pass as `before` to get the next (older) page.
        nextBefore:
          found.length > options.limit ? rows[rows.length - 1].matchId : null,
      };
    },

    getLeaderboard(gameType: string, limit: number) {
      return repo.findLeaderboard(db, gameType, limit);
    },
  };
}

export type StatsService = ReturnType<typeof createStatsService>;
