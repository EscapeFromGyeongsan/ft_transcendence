import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { buildApp } from "../app.ts";
import {
  createGameCommandService,
  type GameRules,
} from "../services/game-command-service.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

const jwtSecret = "test-secret-test-secret-test-secret";
// (14, 14) wins immediately; enough to produce finished matches.
const winAtCorner: GameRules = ({ seat, action }) =>
  action.row === 14 && action.col === 14
    ? {
        ok: true,
        nextTurn: null,
        finish: { outcome: "win", winner: seat, reason: "five_in_row" },
      }
    : { ok: true, nextTurn: seat === "black" ? "white" : "black" };

test("stats routes declare every status code in Swagger", async () => {
  const app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json()
    .paths;
  await app.close();
  const codes = (path: string) => Object.keys(paths[path].get.responses).sort();
  expect(codes("/api/users/{userId}/stats")).toEqual([
    "200",
    "401",
    "404",
    "422",
    "500",
    "503",
  ]);
  expect(codes("/api/users/{userId}/matches")).toEqual([
    "200",
    "401",
    "404",
    "422",
    "500",
    "503",
  ]);
  expect(codes("/api/leaderboard")).toEqual([
    "200",
    "401",
    "422",
    "500",
    "503",
  ]);
});

describe.skipIf(!testDatabaseUrl)("statistics with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;
  let token: string;
  let games: ReturnType<typeof createGameCommandService>;

  beforeAll(async () => {
    database = await openTestDatabase();
    games = createGameCommandService(database.db, {
      gomoku: { version: "test", rules: winAtCorner },
      othello: { version: "test", rules: winAtCorner },
    });
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(database);
    await app?.close();
    app = await buildApp({}, testDatabaseUrl, { jwtSecret });
    for (const nickname of ["p1", "p2", "p3"]) {
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `${nickname}@example.com`,
          password: "password-123",
          nickname,
        },
      });
    }
    token = (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "p1@example.com", password: "password-123" },
      })
    ).json().accessToken;
  });

  // Black places the winning stone, or resigns when `blackResigns` is set.
  async function playMatch(
    gameType: "gomoku" | "othello",
    blackUserId: number,
    whiteUserId: number,
    blackResigns = false,
  ) {
    const matchId = await games.createMatch({
      gameType,
      blackUserId,
      whiteUserId,
    });
    await games.apply({
      matchId,
      userId: blackUserId,
      commandId: randomUUID(),
      expectedVersion: 0,
      action: blackResigns
        ? { type: "resign" }
        : { type: "place", row: 14, col: 14 },
    });
    return matchId;
  }

  const get = (url: string) =>
    app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${token}` },
    });

  test("stats count wins/losses per game type and skip unfinished matches", async () => {
    await playMatch("gomoku", 1, 2); // p1 wins
    await playMatch("gomoku", 1, 2, true); // p1 resigns, p2 wins
    await playMatch("gomoku", 3, 1); // p3 wins
    await playMatch("othello", 1, 2); // other game type
    await games.createMatch({
      gameType: "gomoku",
      blackUserId: 1,
      whiteUserId: 3,
    }); // still playing

    const gomoku = await get("/api/users/1/stats?gameType=gomoku");
    expect(gomoku.statusCode).toBe(200);
    expect(gomoku.json()).toEqual({
      userId: 1,
      gameType: "gomoku",
      wins: 1,
      losses: 2,
      draws: 0,
      played: 3,
      winRate: 1 / 3,
      achievements: { firstWin: true },
      progress: { current: 3, target: 10 },
    });
    const othello = (await get("/api/users/1/stats?gameType=othello")).json();
    expect(othello).toMatchObject({ wins: 1, played: 1, winRate: 1 });
    const empty = (await get("/api/users/3/stats?gameType=othello")).json();
    expect(empty).toMatchObject({
      played: 0,
      winRate: 0,
      achievements: { firstWin: false },
      progress: { current: 0, target: 10 },
    });
  });

  test("stats validation and missing user", async () => {
    expect((await get("/api/users/1/stats")).statusCode).toBe(422);
    expect((await get("/api/users/1/stats?gameType=chess")).statusCode).toBe(
      422,
    );
    expect((await get("/api/users/999/stats?gameType=gomoku")).statusCode).toBe(
      404,
    );
  });

  test("match history is newest first with opponent and paging", async () => {
    const first = await playMatch("gomoku", 1, 2);
    const second = await playMatch("othello", 3, 1);
    const third = await playMatch("gomoku", 2, 1, true);

    const page1 = (await get("/api/users/1/matches?limit=2")).json();
    expect(page1.matches.map((m: { matchId: number }) => m.matchId)).toEqual([
      third,
      second,
    ]);
    expect(page1.matches[0]).toMatchObject({
      gameType: "gomoku",
      result: "win",
      reason: "resign",
      seat: "white",
      opponent: { id: 2, nickname: "p2" },
    });
    expect(page1.nextBefore).toBe(second);
    const page2 = (
      await get(`/api/users/1/matches?limit=2&before=${page1.nextBefore}`)
    ).json();
    expect(page2.matches.map((m: { matchId: number }) => m.matchId)).toEqual([
      first,
    ]);
    expect(page2.nextBefore).toBeNull();

    const othelloOnly = (
      await get("/api/users/1/matches?gameType=othello")
    ).json();
    expect(othelloOnly.matches).toHaveLength(1);
    expect(othelloOnly.matches[0]).toMatchObject({
      result: "loss",
      opponent: { nickname: "p3" },
    });
    expect((await get("/api/users/999/matches")).statusCode).toBe(404);
    expect((await get("/api/users/1/matches?limit=0")).statusCode).toBe(422);
  });

  test("leaderboard orders by wins, then win rate, then user id", async () => {
    await playMatch("gomoku", 1, 2);
    await playMatch("gomoku", 1, 3);
    await playMatch("gomoku", 2, 3);
    await playMatch("gomoku", 3, 2);
    await playMatch("gomoku", 1, 2);
    await playMatch("othello", 2, 1);

    const board = await get("/api/leaderboard?gameType=gomoku");
    expect(board.statusCode).toBe(200);
    expect(board.json()).toEqual([
      { rank: 1, userId: 1, nickname: "p1", wins: 3, played: 3, winRate: 1 },
      // Same wins: p3 (1/3) ranks above p2 (1/4) by win rate.
      {
        rank: 2,
        userId: 3,
        nickname: "p3",
        wins: 1,
        played: 3,
        winRate: 1 / 3,
      },
      { rank: 3, userId: 2, nickname: "p2", wins: 1, played: 4, winRate: 0.25 },
    ]);
    expect((await get("/api/leaderboard?gameType=othello")).json()).toEqual([
      { rank: 1, userId: 2, nickname: "p2", wins: 1, played: 1, winRate: 1 },
      { rank: 2, userId: 1, nickname: "p1", wins: 0, played: 1, winRate: 0 },
    ]);
    expect((await get("/api/leaderboard")).statusCode).toBe(422);
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/leaderboard?gameType=gomoku",
    });
    expect(unauthenticated.statusCode).toBe(401);
  });
  test("an exactly full last page has no next page", async () => {
    await playMatch("gomoku", 1, 2);
    await playMatch("gomoku", 1, 2);
    const page = (await get("/api/users/1/matches?limit=2")).json();
    expect(page.matches).toHaveLength(2);
    expect(page.nextBefore).toBeNull();
  });

  test("the DB refuses partial results on an unfinished match", async () => {
    const matchId = await games.createMatch({
      gameType: "gomoku",
      blackUserId: 1,
      whiteUserId: 2,
    });
    await expect(
      database.db.execute(
        sql`UPDATE games SET outcome = 'win', winner_user_id = 1 WHERE id = ${matchId}`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`UPDATE games SET winner_user_id = 1 WHERE id = ${matchId}`,
      ),
    ).rejects.toThrow();
  });
});
