import { and, asc, eq, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { gameCommands, gamePlayers, games, moves } from "../db/schema/games.ts";

export type Seat = "black" | "white";

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
