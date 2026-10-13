import type { Database } from "../db/client.ts";
import * as repo from "../repositories/stats-repository.ts";

export function createStatsService(db: Database) {
  return {
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
      };
    },

    async getMatches(
      userId: number,
      options: { gameType?: string; before?: number; limit: number },
    ) {
      if (!(await repo.userExists(db, userId))) return undefined;
      const rows = await repo.findFinishedMatches(db, userId, options);
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
          rows.length === options.limit ? rows[rows.length - 1].matchId : null,
      };
    },

    getLeaderboard(gameType: string, limit: number) {
      return repo.findLeaderboard(db, gameType, limit);
    },
  };
}

export type StatsService = ReturnType<typeof createStatsService>;
