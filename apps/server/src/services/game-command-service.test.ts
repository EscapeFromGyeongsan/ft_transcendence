import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../db/schema/users.ts";
import { gameCommands, moves } from "../db/schema/games.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";
import {
  createGameCommandService,
  type GameRules,
} from "./game-command-service.ts";

// Stand-in for the real engine (C): rejects occupied cells, alternates turns,
// and treats (14, 14) as a winning move so the finish path can be tested.
const stubRules: GameRules = ({ moves: history, seat, action }) => {
  if (history.some((m) => m.row === action.row && m.col === action.col)) {
    return { ok: false, code: "CELL_OCCUPIED" };
  }
  if (action.row === 14 && action.col === 14) {
    return {
      ok: true,
      nextTurn: null,
      finish: { outcome: "win", winner: seat, reason: "five_in_row" },
    };
  }
  return { ok: true, nextTurn: seat === "black" ? "white" : "black" };
};

describe.skipIf(!testDatabaseUrl)("game command persistence", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let service: ReturnType<typeof createGameCommandService>;
  let black: number;
  let white: number;
  let outsider: number;
  let matchId: number;

  beforeAll(async () => {
    database = await openTestDatabase();
    service = createGameCommandService(database.db, { gomoku: stubRules });
  });
  afterAll(async () => {
    await database?.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(database);
    const rows = await database.db
      .insert(users)
      .values(
        ["black", "white", "outsider"].map((name) => ({
          email: `${name}@example.com`,
          nickname: name,
          passwordHash: "not-used",
        })),
      )
      .returning({ id: users.id });
    [black, white, outsider] = rows.map((r) => r.id);
    matchId = await service.createMatch({
      gameType: "gomoku",
      rulesVersion: "gomoku-test",
      blackUserId: black,
      whiteUserId: white,
    });
  });

  const place = (
    userId: number,
    expectedVersion: number,
    row: number,
    col: number,
    commandId = randomUUID(),
  ) =>
    service.apply({
      matchId,
      userId,
      commandId,
      expectedVersion,
      action: { type: "place", row, col },
    });
  const moveCount = async () =>
    (await database.db.select().from(moves).where(eq(moves.gameId, matchId)))
      .length;

  test("valid placement bumps the version and passes the turn", async () => {
    expect(await place(black, 0, 7, 7)).toEqual({
      status: "applied",
      stateVersion: 1,
      duplicate: false,
    });
    const match = await service.getMatch(matchId);
    expect(match?.game).toMatchObject({
      stateVersion: 1,
      currentTurn: "white",
      status: "playing",
    });
    expect(match?.moves).toEqual([
      { turnNumber: 1, row: 7, col: 7, stone: "black" },
    ]);
  });

  test("resent commandId returns the first result without applying twice", async () => {
    const commandId = randomUUID();
    await place(black, 0, 7, 7, commandId);
    expect(await place(black, 0, 7, 7, commandId)).toEqual({
      status: "applied",
      stateVersion: 1,
      duplicate: true,
    });
    expect(await moveCount()).toBe(1);
  });

  test("stale version, wrong turn and occupied cell are rejected and recorded", async () => {
    await place(black, 0, 7, 7);
    const commandId = randomUUID();
    expect(await place(white, 0, 7, 8, commandId)).toMatchObject({
      status: "rejected",
      code: "VERSION_CONFLICT",
    });
    expect(await place(white, 0, 7, 8, commandId)).toEqual({
      status: "rejected",
      code: "VERSION_CONFLICT",
      duplicate: true,
    });
    expect(await place(black, 1, 7, 8)).toMatchObject({
      status: "rejected",
      code: "NOT_YOUR_TURN",
    });
    expect(await place(white, 1, 7, 7)).toMatchObject({
      status: "rejected",
      code: "CELL_OCCUPIED",
    });
    const rejected = await database.db
      .select()
      .from(gameCommands)
      .where(eq(gameCommands.status, "rejected"));
    expect(rejected.map((c) => c.rejectCode).sort()).toEqual([
      "CELL_OCCUPIED",
      "NOT_YOUR_TURN",
      "VERSION_CONFLICT",
    ]);
    expect((await service.getMatch(matchId))?.game.stateVersion).toBe(1);
  });

  test("outsiders, unknown matches and borrowed commandIds are refused", async () => {
    expect(await place(outsider, 0, 7, 7)).toMatchObject({
      status: "rejected",
      code: "NOT_PARTICIPANT",
    });
    const missing = await service.apply({
      matchId: 999,
      userId: black,
      commandId: randomUUID(),
      expectedVersion: 0,
      action: { type: "resign" },
    });
    expect(missing).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    const commandId = randomUUID();
    await place(black, 0, 7, 7, commandId);
    expect(await place(white, 1, 7, 8, commandId)).toMatchObject({
      status: "rejected",
      code: "COMMAND_ID_CONFLICT",
    });
  });

  test("parallel commands on the same version: exactly one is applied", async () => {
    const results = await Promise.all([
      place(black, 0, 7, 7),
      place(black, 0, 8, 8),
    ]);
    expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(
      results.filter(
        (r) => r.status === "rejected" && r.code === "VERSION_CONFLICT",
      ),
    ).toHaveLength(1);
    expect(await moveCount()).toBe(1);
  });

  test("parallel resend of one commandId applies once", async () => {
    const commandId = randomUUID();
    const results = await Promise.all([
      place(black, 0, 7, 7, commandId),
      place(black, 0, 7, 7, commandId),
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    expect(await moveCount()).toBe(1);
  });

  test("winning move finishes the match once and stores per-player results", async () => {
    expect(await place(black, 0, 14, 14)).toMatchObject({
      status: "applied",
      stateVersion: 1,
    });
    const match = await service.getMatch(matchId);
    expect(match?.game).toMatchObject({
      status: "finished",
      outcome: "win",
      resultReason: "five_in_row",
      winnerUserId: black,
      currentTurn: null,
    });
    expect(match?.game.finishedAt).toBeInstanceOf(Date);
    expect(
      Object.fromEntries(match!.players.map((p) => [p.userId, p.result])),
    ).toEqual({
      [black]: "win",
      [white]: "loss",
    });
    expect(await place(white, 1, 0, 0)).toMatchObject({
      status: "rejected",
      code: "GAME_FINISHED",
    });
  });

  test("resign gives the win to the opponent", async () => {
    const result = await service.apply({
      matchId,
      userId: black,
      commandId: randomUUID(),
      expectedVersion: 0,
      action: { type: "resign" },
    });
    expect(result).toMatchObject({ status: "applied", stateVersion: 1 });
    const match = await service.getMatch(matchId);
    expect(match?.game).toMatchObject({
      outcome: "win",
      resultReason: "resign",
      winnerUserId: white,
    });
  });

  test("a failed save rolls back everything (no partial move or command)", async () => {
    const brokenRules: GameRules = () => ({ ok: true, nextTurn: "white" });
    const broken = createGameCommandService(database.db, {
      gomoku: brokenRules,
    });
    // Row 15 violates the moves CHECK constraint inside the transaction.
    await expect(
      broken.apply({
        matchId,
        userId: black,
        commandId: randomUUID(),
        expectedVersion: 0,
        action: { type: "place", row: 15, col: 0 },
      }),
    ).rejects.toThrow();
    expect(await moveCount()).toBe(0);
    expect(await database.db.select().from(gameCommands)).toHaveLength(0);
    expect((await service.getMatch(matchId))?.game.stateVersion).toBe(0);
  });
});
