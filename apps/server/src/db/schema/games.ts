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

// Values follow @cafe/game-contracts (GameType, GameStatus, TwoPlayerResult).
// Plain text + CHECK instead of pg enums so adding a value is a simple migration.
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
    // A result exists exactly when the match is finished; only a win has a winner.
    check(
      "games_result_check",
      sql`(${table.status} = 'finished') = (${table.outcome} IS NOT NULL AND ${table.resultReason} IS NOT NULL AND ${table.finishedAt} IS NOT NULL)`,
    ),
    check(
      "games_winner_check",
      sql`(${table.outcome} = 'win') = (${table.winnerUserId} IS NOT NULL)`,
    ),
    check("games_state_version_check", sql`${table.stateVersion} >= 0`),
  ],
);

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

// Authoritative move history. Board state is rebuilt by replaying these rows.
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

// One row per processed command. UNIQUE(game_id, command_id) blocks a resent
// command from being applied twice; the stored outcome is replayed instead.
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
