import type { Database } from "./db/database.ts";
import type { RoomSnapshot } from "./rooms.ts";

export async function saveResult(db: Database, room: RoomSnapshot) {
  const result = room.result;
  if (!result || !room.startedAt || !room.finishedAt)
    throw new Error("Incomplete match result");
  const seats = new Set(room.players.map((player) => player.seat));
  if (
    result.kind === "win" &&
    (!result.winnerSeats.length ||
      result.winnerSeats.some((seat) => !seats.has(seat)))
  )
    throw new Error("Invalid winner seats");
  if (result.kind === "draw" && result.winnerSeats.length)
    throw new Error("Draw cannot have winners");
  const participants = room.players.map((player) => ({
    user_id: player.id,
    seat: player.seat,
    name: player.name,
    outcome:
      result.kind === "draw"
        ? "draw"
        : result.winnerSeats.includes(player.seat)
          ? "win"
          : "loss",
  }));
  // A single statement is atomic in both PostgreSQL and PGlite. No cross-query pool transaction.
  // On retry, an existing match inserts no participants and cannot be counted twice.
  await db.query(
    `WITH saved AS (
    INSERT INTO game_matches (id, game_type, room_id, room_title, started_at, finished_at, reason, move_count)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id
  ) INSERT INTO game_match_players (match_id, user_id, seat, name, outcome)
    SELECT saved.id, p.user_id, p.seat, p.name, p.outcome FROM saved,
      jsonb_to_recordset($9::jsonb) AS p(user_id UUID, seat INTEGER, name TEXT, outcome TEXT)`,
    [
      room.matchId,
      room.gameType,
      room.id,
      room.title,
      room.startedAt,
      room.finishedAt,
      result.reason,
      result.moveCount,
      JSON.stringify(participants),
    ],
  );
}
export async function history(db: Database, userId: string, offset = 0) {
  const summary = (
    await db.query<{ total: number; wins: number; draws: number }>(
      `SELECT
    count(*)::int AS total, count(*) FILTER (WHERE outcome = 'win')::int AS wins,
    count(*) FILTER (WHERE outcome = 'draw')::int AS draws FROM game_match_players WHERE user_id = $1`,
      [userId],
    )
  ).rows[0];
  const rows = (
    await db.query(
      `SELECT m.id, m.game_type AS "gameType", m.room_title AS "roomTitle",
    m.started_at AS "startedAt", m.finished_at AS "finishedAt", self.outcome, m.reason, m.move_count AS "moveCount",
    (SELECT string_agg(other.name, ', ' ORDER BY other.seat) FROM game_match_players other
      WHERE other.match_id = m.id AND other.user_id <> $1) AS opponent
    FROM game_matches m JOIN game_match_players self ON self.match_id = m.id AND self.user_id = $1
    ORDER BY m.finished_at DESC, m.id DESC LIMIT 20 OFFSET $2`,
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
