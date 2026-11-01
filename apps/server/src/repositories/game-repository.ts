import type { PlayerColor } from "@cafe/game-contracts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { gameCommands, gamePlayers, games, moves } from "../db/schema/games.ts";

export type Seat = PlayerColor;

export async function insertGame(
  db: Executor,
  values: {
    gameType: string;
    rulesVersion: string;
    status: string;
    currentTurn: Seat | null;
    startedAt: Date | null;
  },
) {
  const [game] = await db
    .insert(games)
    .values(values)
    .returning({ id: games.id });
  return game;
}

export async function insertPlayer(
  db: Executor,
  values: { gameId: number; userId: number; seat: Seat },
) {
  await db.insert(gamePlayers).values(values);
}

// Row lock on the match. Every path that changes a match takes this first, so
// changes to one match are serialized while other matches run in parallel.
export async function findGameForUpdate(db: Executor, gameId: number) {
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.id, gameId))
    .for("update");
  return game;
}

export async function findGame(db: Executor, gameId: number) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  return game;
}

export function findPlayers(db: Executor, gameId: number) {
  return db
    .select({
      userId: gamePlayers.userId,
      seat: gamePlayers.seat,
      result: gamePlayers.result,
    })
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, gameId));
}

export function findMoves(db: Executor, gameId: number) {
  return db
    .select({
      turnNumber: moves.turnNumber,
      row: moves.rowIdx,
      col: moves.colIdx,
      stone: moves.stone,
    })
    .from(moves)
    .where(eq(moves.gameId, gameId))
    .orderBy(asc(moves.turnNumber));
}

export async function findCommand(
  db: Executor,
  gameId: number,
  commandId: string,
) {
  const [command] = await db
    .select({
      userId: gameCommands.userId,
      status: gameCommands.status,
      appliedVersion: gameCommands.appliedVersion,
      rejectCode: gameCommands.rejectCode,
    })
    .from(gameCommands)
    .where(
      and(
        eq(gameCommands.gameId, gameId),
        eq(gameCommands.commandId, commandId),
      ),
    );
  return command;
}

export async function insertCommand(
  db: Executor,
  values: {
    gameId: number;
    userId: number;
    commandId: string;
    commandType: string;
    expectedVersion: number;
    status: "applied" | "rejected";
    appliedVersion?: number;
    rejectCode?: string;
  },
) {
  await db.insert(gameCommands).values(values);
}

export async function insertMove(
  db: Executor,
  values: {
    gameId: number;
    userId: number;
    turnNumber: number;
    rowIdx: number;
    colIdx: number;
    stone: Seat;
  },
) {
  await db.insert(moves).values(values);
}

export async function updateGameAfterCommand(
  db: Executor,
  gameId: number,
  values: {
    stateVersion: number;
    currentTurn: Seat | null;
    status?: string;
    outcome?: string;
    resultReason?: string;
    winnerUserId?: number | null;
    finishedAt?: Date;
  },
) {
  await db
    .update(games)
    .set({ ...values, updatedAt: sql`now()` })
    .where(eq(games.id, gameId));
}

// Compare-and-set on status in one UPDATE: it waits for the match lock and
// re-checks the status, so it never overwrites a status that moved on.
export async function updateGameStatus(
  db: Executor,
  gameId: number,
  from: string,
  to: string,
) {
  const updated = await db
    .update(games)
    .set({ status: to, updatedAt: sql`now()` })
    .where(and(eq(games.id, gameId), eq(games.status, from)))
    .returning({ id: games.id });
  return updated.length > 0;
}

export async function setPlayerResult(
  db: Executor,
  gameId: number,
  userId: number,
  result: "win" | "loss" | "draw" | "void",
) {
  await db
    .update(gamePlayers)
    .set({ result })
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)));
}

// Finishes every unfinished match as void and returns their ids.
export async function voidUnfinishedGames(db: Executor, reason: string) {
  const voided = await db
    .update(games)
    .set({
      status: "finished",
      outcome: "void",
      resultReason: reason,
      currentTurn: null,
      finishedAt: sql`now()`,
      stateVersion: sql`${games.stateVersion} + 1`,
      updatedAt: sql`now()`,
    })
    .where(inArray(games.status, ["playing", "paused"]))
    .returning({ id: games.id });
  const ids = voided.map((game) => game.id);
  if (ids.length > 0) {
    await db
      .update(gamePlayers)
      .set({ result: "void" })
      .where(inArray(gamePlayers.gameId, ids));
  }
  return ids;
}
