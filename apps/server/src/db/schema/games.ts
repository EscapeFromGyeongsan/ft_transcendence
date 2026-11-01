import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * 경기 한 판의 서버 확정 상태입니다. `state_version`은 확정된 변경마다 1씩 오릅니다.
 *
 * @remarks
 * 값은 `@cafe/game-contracts`(GameType, GameStatus, TwoPlayerResult)를 따릅니다.
 * 값을 추가할 때 migration이 단순하도록 pg enum 대신 text + CHECK를 씁니다.
 */
export const games = pgTable(
  "games",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    gameType: text("game_type").notNull(),
    rulesVersion: text("rules_version").notNull(),
    status: text("status").notNull().default("waiting"),
    stateVersion: integer("state_version").notNull().default(0),
    currentTurn: text("current_turn"),
    outcome: text("outcome"),
    resultReason: text("result_reason"),
    winnerUserId: bigint("winner_user_id", { mode: "number" }).references(
      () => users.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "games_game_type_check",
      sql`${table.gameType} IN ('gomoku', 'othello')`,
    ),
    check(
      "games_status_check",
      sql`${table.status} IN ('waiting', 'playing', 'paused', 'finished')`,
    ),
    check(
      "games_current_turn_check",
      sql`${table.currentTurn} IS NULL OR ${table.currentTurn} IN ('black', 'white')`,
    ),
    check(
      "games_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('win', 'draw', 'void')`,
    ),
    // Unfinished: no result fields at all. Finished: outcome, reason and time
    // are all set. Only a win has a winner.
    check(
      "games_result_check",
      sql`(${table.status} = 'finished' AND ${table.outcome} IS NOT NULL AND ${table.resultReason} IS NOT NULL AND ${table.finishedAt} IS NOT NULL) OR (${table.status} <> 'finished' AND ${table.outcome} IS NULL AND ${table.resultReason} IS NULL AND ${table.finishedAt} IS NULL AND ${table.winnerUserId} IS NULL)`,
    ),
    check(
      "games_winner_check",
      sql`(${table.outcome} = 'win' AND ${table.winnerUserId} IS NOT NULL) OR (${table.outcome} IS DISTINCT FROM 'win' AND ${table.winnerUserId} IS NULL)`,
    ),
    check("games_state_version_check", sql`${table.stateVersion} >= 0`),
  ],
);

/** 경기 참가자와 좌석(`black`/`white`)입니다. `result`는 경기가 끝날 때 채웁니다. */
export const gamePlayers = pgTable(
  "game_players",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    gameId: bigint("game_id", { mode: "number" })
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    seat: text("seat").notNull(),
    result: text("result"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (table) => [
    unique("game_players_game_user_unique").on(table.gameId, table.userId),
    unique("game_players_game_seat_unique").on(table.gameId, table.seat),
    index("game_players_user_result_idx").on(table.userId, table.result),
    check("game_players_seat_check", sql`${table.seat} IN ('black', 'white')`),
    check(
      "game_players_result_check",
      sql`${table.result} IS NULL OR ${table.result} IN ('win', 'loss', 'draw', 'void')`,
    ),
  ],
);

/**
 * 서버가 확정한 착수 기록입니다. 판 상태는 이 행들을 다시 적용해 만듭니다.
 *
 * @remarks
 * 좌표는 0 기준 `row_idx`·`col_idx`(0..14)입니다. 같은 경기에서 수 번호와 칸은 각각 한 번만 나옵니다.
 */
export const moves = pgTable(
  "moves",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    gameId: bigint("game_id", { mode: "number" })
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    turnNumber: integer("turn_number").notNull(),
    rowIdx: smallint("row_idx").notNull(),
    colIdx: smallint("col_idx").notNull(),
    stone: text("stone").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("moves_game_turn_unique").on(table.gameId, table.turnNumber),
    unique("moves_game_cell_unique").on(
      table.gameId,
      table.rowIdx,
      table.colIdx,
    ),
    check("moves_row_check", sql`${table.rowIdx} BETWEEN 0 AND 14`),
    check("moves_col_check", sql`${table.colIdx} BETWEEN 0 AND 14`),
    check("moves_stone_check", sql`${table.stone} IN ('black', 'white')`),
    check("moves_turn_check", sql`${table.turnNumber} >= 1`),
  ],
);

/**
 * 처리한 명령마다 한 행입니다.
 *
 * @remarks
 * UNIQUE(game_id, command_id)로 재전송된 명령이 두 번 적용되지 않습니다. 대신 저장된 결과를 다시 돌려줍니다.
 */
export const gameCommands = pgTable(
  "game_commands",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    gameId: bigint("game_id", { mode: "number" })
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    commandId: uuid("command_id").notNull(),
    commandType: text("command_type").notNull(),
    expectedVersion: integer("expected_version").notNull(),
    appliedVersion: integer("applied_version"),
    status: text("status").notNull(),
    rejectCode: text("reject_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("game_commands_game_command_unique").on(
      table.gameId,
      table.commandId,
    ),
    check(
      "game_commands_status_check",
      sql`(${table.status} = 'applied' AND ${table.appliedVersion} IS NOT NULL AND ${table.rejectCode} IS NULL) OR (${table.status} = 'rejected' AND ${table.appliedVersion} IS NULL AND ${table.rejectCode} IS NOT NULL)`,
    ),
  ],
);
