import type { Database } from "./db/database.ts";
import type { RoomSnapshot } from "./rooms.ts";

export async function saveResult(db: Database, room: RoomSnapshot) {
  const result = room.game.result;
  if (!result || !room.startedAt || !room.finishedAt)
    throw new Error("Incomplete match result");
  const black = room.players.find((player) => player.seat === 0)!;
  const white = room.players.find((player) => player.seat === 1)!;
  // One atomic insert stores the result and both participants; match ID makes retries idempotent.
  await db.query(
    `INSERT INTO matches
    (id, room_id, room_title, black_user_id, white_user_id, black_name, white_name,
     started_at, finished_at, winner, reason, move_count)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
    [
      room.matchId,
      room.id,
      room.title,
      black.id,
      white.id,
      black.name,
      white.name,
      room.startedAt,
      room.finishedAt,
      result.kind === "win" ? result.winner : null,
      result.kind === "win" ? result.reason : "draw",
      room.game.moves.length,
    ],
  );
}
export async function history(db: Database, userId: string, offset = 0) {
  const condition = "black_user_id = $1 OR white_user_id = $1";
  const won =
    "(winner = 'black' AND black_user_id = $1) OR (winner = 'white' AND white_user_id = $1)";
  const summary = (
    await db.query<{ total: number; wins: number; draws: number }>(
      `SELECT
    count(*)::int AS total, count(*) FILTER (WHERE ${won})::int AS wins,
    count(*) FILTER (WHERE winner IS NULL)::int AS draws FROM matches WHERE ${condition}`,
      [userId],
    )
  ).rows[0];
  const rows = (
    await db.query(
      `SELECT id, room_title AS "roomTitle", started_at AS "startedAt", finished_at AS "finishedAt",
    CASE WHEN black_user_id = $1 THEN white_name ELSE black_name END AS opponent,
    CASE WHEN winner IS NULL THEN 'draw' WHEN ${won} THEN 'win' ELSE 'loss' END AS outcome,
    reason, move_count AS "moveCount" FROM matches WHERE ${condition}
    ORDER BY finished_at DESC, id DESC LIMIT 20 OFFSET $2`,
      [userId, offset],
    )
  ).rows;
  return {
    summary: {
      ...summary,
      losses: summary.total - summary.wins - summary.draws,
      winRate: summary.total
        ? Math.round((summary.wins / summary.total) * 1000) / 10
        : 0,
    },
    matches: rows,
    nextOffset:
      offset + rows.length < summary.total ? offset + rows.length : null,
  };
}
