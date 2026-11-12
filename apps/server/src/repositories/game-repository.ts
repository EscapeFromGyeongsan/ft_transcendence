import type { PlayerColor } from "@cafe/game-contracts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "../db/client.ts";
import { gameCommands, gamePlayers, games, moves } from "../db/schema/games.ts";
import { users } from "../db/schema/users.ts";

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

/**
 * 경기 참가자 행을 추가합니다.
 *
 * @remarks
 * 같은 INSERT에서 사용자의 현재 닉네임을 `nickname_snapshot`으로 저장합니다. 경기 기록은 이 값을 보여 주므로 이후 닉네임 변경·탈퇴가 과거 기록을 바꾸지 않습니다(DEC-09).
 */
export async function insertPlayer(
  db: Executor,
  values: { gameId: number; userId: number; seat: Seat },
) {
  await db.insert(gamePlayers).values({
    ...values,
    nicknameSnapshot: sql`(SELECT ${users.nickname} FROM ${users} WHERE ${users.id} = ${values.userId})`,
  });
}

/**
 * 경기 행을 읽고 잠급니다(`FOR UPDATE`).
 *
 * @remarks
 * 경기를 바꾸는 모든 경로가 이 잠금을 먼저 잡으므로 한 경기의 변경은 직렬화되고, 다른 경기는 병렬로 진행됩니다.
 * 트랜잭션 안에서 호출해야 합니다.
 */
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

/**
 * 사용자가 참가한 끝나지 않은 경기 하나의 ID를 찾습니다. 없으면 `undefined`입니다.
 *
 * @remarks FR-MATCH-02에 따라 사용자당 진행 중 경기는 하나입니다.
 */
export async function findActiveGameIdForUser(db: Executor, userId: number) {
  const [row] = await db
    .select({ id: games.id })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(
      and(
        eq(gamePlayers.userId, userId),
        inArray(games.status, ["waiting", "playing", "paused"]),
      ),
    )
    .limit(1);
  return row?.id;
}

/** 경기의 착수 기록을 수 번호 오름차순으로 읽습니다. */
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

/** 같은 경기에서 이미 처리한 `commandId`의 기록을 찾습니다. 중복 재전송 판정에 씁니다. */
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

/** 명령 적용 후 경기 행을 갱신합니다. 버전·차례와 함께, 종료면 결과 필드도 넘깁니다. */
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

/**
 * 경기 상태가 `from`일 때만 `to`로 바꿉니다.
 *
 * @returns 바꿨으면 `true`, 상태가 이미 달라졌거나 경기가 없으면 `false`
 *
 * @remarks
 * 한 UPDATE 안의 compare-and-set입니다. 경기 행 잠금을 기다린 뒤 상태를 다시 확인하므로 이미 바뀐 상태를 덮어쓰지 않습니다.
 */
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

/**
 * 진행 중(`playing`·`paused`)인 모든 경기를 무효로 끝내고 그 ID를 돌려줍니다.
 *
 * @remarks
 * 각 경기의 `state_version`을 1 올리고 두 참가자 결과를 `void`로 바꿉니다. 두 UPDATE를 함께 반영하려면 트랜잭션 안에서 호출합니다.
 */
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
