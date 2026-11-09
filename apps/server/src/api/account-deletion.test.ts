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
import { currentStep, totpCode } from "../core/totp.ts";
import { users } from "../db/schema/users.ts";
import { createAuthService } from "../services/auth-service.ts";
import {
  createGameCommandService,
  type GameRules,
} from "../services/game-command-service.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

const config = {
  jwtSecret: "test-secret-test-secret-test-secret",
  twoFactorKey: "two-factor-key-two-factor-key-two-factor",
};
// (14, 14) wins immediately; enough to produce a finished match.
const winAtCorner: GameRules = ({ seat, action }) =>
  action.row === 14 && action.col === 14
    ? {
        ok: true,
        nextTurn: null,
        finish: { outcome: "win", winner: seat, reason: "five_in_row" },
      }
    : { ok: true, nextTurn: seat === "black" ? "white" : "black" };

test("account deletion declares every status code in Swagger", async () => {
  const app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json()
    .paths;
  await app.close();
  expect(Object.keys(paths["/api/users/me"].delete.responses).sort()).toEqual([
    "204",
    "400",
    "401",
    "403",
    "409",
    "413",
    "415",
    "422",
    "429",
    "500",
    "503",
  ]);
});

describe.skipIf(!testDatabaseUrl)("account deletion with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;
  let token: string;
  let games: ReturnType<typeof createGameCommandService>;

  beforeAll(async () => {
    database = await openTestDatabase();
    games = createGameCommandService(database.db, {
      gomoku: { version: "test", rules: winAtCorner, board: () => [] },
      othello: { version: "test", rules: winAtCorner, board: () => [] },
    });
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  const register = (nickname: string) =>
    app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: `${nickname}@example.com`,
        password: "password-123",
        nickname,
      },
    });
  const login = (nickname: string) =>
    app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: `${nickname}@example.com`, password: "password-123" },
    });
  const deleteMe = (payload?: object, bearer = token) =>
    app.inject({
      method: "DELETE",
      url: "/api/users/me",
      headers: { authorization: `Bearer ${bearer}` },
      ...(payload ? { payload } : {}),
    });
  const get = (url: string, bearer = token) =>
    app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${bearer}` },
    });

  // OAuth-only account (no password) logged in directly through the service.
  async function oauthOnlyUser(nickname: string) {
    const [user] = await database.db
      .insert(users)
      .values({ email: `${nickname}@42.example`, nickname, passwordHash: null })
      .returning({ id: users.id });
    const tokens = await createAuthService(database.db, config).completeLogin(
      user.id,
    );
    if (!("accessToken" in tokens)) throw new Error("unexpected 2FA");
    return { id: user.id, token: tokens.accessToken };
  }

  async function finishedMatch(blackUserId: number, whiteUserId: number) {
    const matchId = await games.createMatch({
      gameType: "gomoku",
      blackUserId,
      whiteUserId,
    });
    await games.apply({
      matchId,
      userId: blackUserId,
      commandId: randomUUID(),
      expectedVersion: 0,
      action: { type: "place", row: 14, col: 14 },
    });
  }

  beforeEach(async () => {
    await resetTestDatabase(database);
    await app?.close();
    app = await buildApp({}, testDatabaseUrl, config);
    await register("p1");
    await register("p2");
    token = (await login("p1")).json().accessToken;
  });

  test("wrong or missing password is refused and changes nothing", async () => {
    const wrong = await deleteMe({ password: "wrong-password" });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe("INVALID_CREDENTIALS");
    const missing = await deleteMe();
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("INVALID_CREDENTIALS");
    expect((await get("/api/users/me")).statusCode).toBe(200);
  });

  test("deletion revokes sessions, removes the profile and frees email and nickname", async () => {
    const response = await deleteMe({ password: "password-123" });
    expect(response.statusCode).toBe(204);

    expect((await get("/api/users/me")).statusCode).toBe(401);
    expect((await login("p1")).statusCode).toBe(401);
    const other = (await login("p2")).json().accessToken;
    expect((await get("/api/users/1", other)).statusCode).toBe(404);
    expect(
      (await get("/api/users/1/stats?gameType=gomoku", other)).statusCode,
    ).toBe(404);

    // Old email and nickname can be used by a new account.
    expect((await register("p1")).statusCode).toBe(201);
    const [row] = await database.db
      .execute<{
        email: string;
        nickname: string;
        password_hash: string | null;
        deleted_at: Date | null;
      }>(
        sql`SELECT email, nickname, password_hash, deleted_at FROM users WHERE id = 1`,
      )
      .then((result) => result.rows);
    expect(row).toMatchObject({
      email: "deleted:1",
      nickname: "deleted:1",
      password_hash: null,
    });
    expect(row.deleted_at).not.toBeNull();
  });

  test("match history keeps the nickname at match time and marks deletion", async () => {
    await finishedMatch(1, 2); // p1 wins against p2
    await app.inject({
      method: "PATCH",
      url: "/api/users/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { nickname: "renamed" },
    });
    const p2 = (await login("p2")).json().accessToken;
    const before = await get("/api/users/2/matches", p2);
    expect(before.json().matches[0].opponent).toEqual({
      id: 1,
      nickname: "p1",
      deleted: false,
    });

    expect((await deleteMe({ password: "password-123" })).statusCode).toBe(204);
    const after = await get("/api/users/2/matches", p2);
    expect(after.json().matches[0].opponent).toEqual({
      id: 1,
      nickname: "p1",
      deleted: true,
    });
    const board = await get("/api/leaderboard?gameType=gomoku", p2);
    expect(board.json().map((row: { userId: number }) => row.userId)).toEqual([
      2,
    ]);
  });

  test("an unfinished match blocks deletion", async () => {
    await games.createMatch({
      gameType: "gomoku",
      blackUserId: 1,
      whiteUserId: 2,
    });
    const response = await deleteMe({ password: "password-123" });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACTIVE_MATCH");
    expect((await get("/api/users/me")).statusCode).toBe(200);
  });

  test("OAuth-only account without 2FA needs a recent login", async () => {
    const fresh = await oauthOnlyUser("oauth1");
    expect((await deleteMe(undefined, fresh.token)).statusCode).toBe(204);

    const stale = await oauthOnlyUser("oauth2");
    await database.db.execute(
      sql`UPDATE sessions SET created_at = now() - interval '11 minutes' WHERE user_id = ${stale.id}`,
    );
    const response = await deleteMe(undefined, stale.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("RECENT_LOGIN_REQUIRED");
  });

  test("OAuth-only account with 2FA confirms with a code", async () => {
    const user = await oauthOnlyUser("oauth3");
    const post = (url: string, payload?: object) =>
      app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${user.token}` },
        ...(payload ? { payload } : {}),
      });
    const setup = (await post("/api/auth/2fa/setup")).json();
    const enabled = await post("/api/auth/2fa/enable", {
      code: totpCode(setup.secret, currentStep()),
    });
    const [recoveryCode] = enabled.json().recoveryCodes;

    const wrong = await deleteMe({ code: "000000" }, user.token);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe("INVALID_TWO_FACTOR_CODE");
    expect(
      (await deleteMe({ code: recoveryCode }, user.token)).statusCode,
    ).toBe(204);
    const [secrets] = await database.db
      .execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM two_factor_secrets WHERE user_id = ${user.id}`,
      )
      .then((result) => result.rows);
    expect(secrets.count).toBe(0);
  });

  test("a malformed field is rejected with 422", async () => {
    const response = await deleteMe({ password: "" });
    expect(response.statusCode).toBe(422);
    expect((await get("/api/users/me")).statusCode).toBe(200);
  });
});
