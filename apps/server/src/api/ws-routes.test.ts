import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Cell } from "@cafe/game-contracts";
import { gomoku } from "@cafe/game-engine";
import { buildApp } from "../app.ts";
import { signAccessToken } from "../core/tokens.ts";
import {
  createGameCommandService,
  type RegisteredRules,
} from "../services/game-command-service.ts";
import {
  MAX_PENDING_MESSAGES,
  parseCommand,
  parseEnvelope,
  wsRateLimit,
} from "./ws-routes.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

const jwtSecret = "test-secret-test-secret-test-secret";
const password = "password-123";

// Stand-in for the real engine (C): only the board is needed to show a match.
const stubGomoku: RegisteredRules = {
  version: "stub-1",
  rules: ({ seat }) => ({
    ok: true,
    nextTurn: seat === "black" ? "white" : "black",
  }),
  board: (history) => {
    const board: Cell[][] = Array.from({ length: 15 }, () =>
      Array<Cell>(15).fill(null),
    );
    for (const m of history) board[m.row][m.col] = m.stone as Cell;
    return board;
  },
};

// Listeners must be attached before the message that triggers the reply.
function nextMessage(socket: WebSocket) {
  return new Promise<unknown>((resolve) =>
    socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
  );
}

function closed(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
}

function sendJson(socket: WebSocket, message: unknown) {
  socket.send(JSON.stringify(message));
}

// Buffers every message so several replies in a row are not missed.
function inbox(socket: WebSocket) {
  const queue: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queue.push(message);
  });
  return () =>
    queue.length > 0
      ? Promise.resolve(queue.shift())
      : new Promise<unknown>((resolve) => waiting.push(resolve));
}

test("parseEnvelope accepts only { type, requestId?, payload } objects", () => {
  expect(parseEnvelope('{"type":"ping","payload":{}}')).toEqual({
    type: "ping",
    requestId: undefined,
    payload: {},
  });
  expect(
    parseEnvelope('{"type":"ping","requestId":"r1","payload":{}}'),
  ).toMatchObject({ requestId: "r1" });
  for (const bad of [
    "not json",
    "[]",
    "null",
    '{"payload":{}}',
    '{"type":1,"payload":{}}',
    '{"type":"ping"}',
    '{"type":"ping","payload":[]}',
    '{"type":"ping","requestId":"","payload":{}}',
    `{"type":"ping","requestId":"${"r".repeat(65)}","payload":{}}`,
  ]) {
    expect(parseEnvelope(bad)).toBeNull();
  }
});

// injectWS needs a ready app; route tests below without app.inject() call it.
async function connect(app: FastifyInstance) {
  await app.ready();
  return app.injectWS("/api/ws");
}

test("parseCommand checks the shared GameCommand shape", () => {
  const valid = {
    matchId: 1,
    gameType: "gomoku",
    commandId: "8f14e45f-ceea-4e7a-9d3c-2f6b1a0c9b11",
    expectedVersion: 0,
    action: { type: "place", row: 7, col: 7, extra: true },
  };
  expect(parseCommand(valid)).toEqual({
    matchId: 1,
    gameType: "gomoku",
    commandId: valid.commandId,
    expectedVersion: 0,
    action: { type: "place", row: 7, col: 7 },
  });
  expect(parseCommand({ ...valid, action: { type: "resign" } })).toMatchObject({
    action: { type: "resign" },
  });
  for (const change of [
    { matchId: "1" },
    { gameType: "chess" },
    { gameType: undefined },
    { commandId: "c1" },
    { expectedVersion: -1 },
    { expectedVersion: 1.5 },
    { expectedVersion: 2_147_483_648 },
    { action: { type: "place", row: "7", col: 7 } },
    { action: { type: "place", row: 7 } },
    { action: { type: "undo" } },
    { action: undefined },
  ]) {
    expect(parseCommand({ ...valid, ...change })).toBeNull();
  }
});

describe("/api/ws without a database", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  test("closes 4401 when no auth message arrives in time", async () => {
    app = await buildApp({}, undefined, { jwtSecret }, undefined, {
      authTimeoutMs: 50,
    });
    const socket = await connect(app);
    expect(await closed(socket)).toEqual({
      code: 4401,
      reason: "Authentication timed out.",
    });
  });

  test("closes 4400 on a malformed message", async () => {
    app = await buildApp({}, undefined, { jwtSecret });
    const socket = await connect(app);
    const close = closed(socket);
    socket.send("not json");
    expect((await close).code).toBe(4400);
  });

  test("closes 4401 when the first message is not auth", async () => {
    app = await buildApp({}, undefined, { jwtSecret });
    const socket = await connect(app);
    const close = closed(socket);
    sendJson(socket, { type: "ping", payload: {} });
    expect((await close).code).toBe(4401);
  });

  test("closes 4400 on a binary message", async () => {
    app = await buildApp({}, undefined, { jwtSecret });
    const socket = await connect(app);
    const close = closed(socket);
    socket.send(Buffer.from('{"type":"auth","payload":{}}'));
    expect((await close).code).toBe(4400);
  });

  test("a message over 16 KiB is closed by ws with 1009", async () => {
    app = await buildApp({}, undefined, { jwtSecret });
    const socket = await connect(app);
    const close = closed(socket);
    sendJson(socket, { type: "auth", payload: { pad: "x".repeat(17_000) } });
    expect((await close).code).toBe(1009);
  });

  test("closes 1011 when the database fails during authentication", async () => {
    // A correctly signed token reaches the session lookup, which fails
    // because nothing listens on port 1.
    const validToken = signAccessToken(
      { userId: 1, sessionId: "00000000-0000-4000-8000-000000000000" },
      jwtSecret,
      60,
    );
    app = await buildApp({}, "postgresql://cafe:x@127.0.0.1:1/cafe_none", {
      jwtSecret,
    });
    const socket = await connect(app);
    const close = closed(socket);
    sendJson(socket, { type: "auth", payload: { accessToken: validToken } });
    expect((await close).code).toBe(1011);
  });

  test("upgrades over the per-IP limit are refused with 429", async () => {
    app = await buildApp({}, undefined, { jwtSecret });
    await app.ready();
    const sockets: WebSocket[] = [];
    for (let i = 0; i < wsRateLimit.rateLimit.max; i++) {
      sockets.push(await app.injectWS("/api/ws"));
    }
    await expect(app.injectWS("/api/ws")).rejects.toThrow(/429/);
    for (const socket of sockets) socket.terminate();
  });

  test("closes 1011 when authentication is unavailable", async () => {
    app = await buildApp({}, undefined, { jwtSecret });
    const socket = await connect(app);
    const close = closed(socket);
    sendJson(socket, { type: "auth", payload: { accessToken: "x" } });
    expect((await close).code).toBe(1011);
  });
});

describe.skipIf(!testDatabaseUrl)("/api/ws with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await openTestDatabase();
  });
  beforeEach(async () => {
    await resetTestDatabase(database);
    await app?.close();
    app = await buildApp(
      {},
      testDatabaseUrl,
      { jwtSecret },
      undefined,
      {},
      { gomoku: stubGomoku },
    );
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  async function loginToken(n = 1) {
    return (await loginTokens(n)).accessToken;
  }

  // Registers and logs in user p<n>; ids follow registration order.
  async function loginTokens(n = 1) {
    const email = `p${n}@example.com`;
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password, nickname: `p${n}` },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    return response.json() as { accessToken: string; refreshToken: string };
  }

  async function authenticated(accessToken: string) {
    const socket = await connect(app);
    const reply = nextMessage(socket);
    sendJson(socket, {
      type: "auth",
      requestId: "a1",
      payload: { accessToken },
    });
    return { socket, reply: await reply };
  }

  test("auth with a valid token answers auth.ok, then ping gets pong", async () => {
    const { socket, reply } = await authenticated(await loginToken());
    expect(reply).toEqual({
      type: "auth.ok",
      requestId: "a1",
      payload: { userId: 1 },
    });

    const pong = nextMessage(socket);
    sendJson(socket, { type: "ping", requestId: "p1", payload: {} });
    expect(await pong).toEqual({ type: "pong", requestId: "p1", payload: {} });

    const error = nextMessage(socket);
    sendJson(socket, { type: "unknown.event", requestId: "u1", payload: {} });
    expect(await error).toMatchObject({
      type: "error",
      requestId: "u1",
      payload: { code: "UNSUPPORTED_MESSAGE" },
    });
    socket.terminate();
  });

  test("a client that floods messages without waiting is closed with 1008", async () => {
    const { socket } = await authenticated(await loginToken());
    const close = closed(socket);
    // Each subscribe waits for the DB, so these pile up in the queue.
    for (let i = 0; i <= MAX_PENDING_MESSAGES; i++) {
      sendJson(socket, { type: "match.subscribe", payload: { matchId: 1 } });
    }
    expect(await close).toEqual({
      code: 1008,
      reason: "Too many pending messages.",
    });
  });

  test("a second message while authenticating is closed with 4401", async () => {
    const accessToken = await loginToken();
    const socket = await connect(app);
    const close = closed(socket);
    sendJson(socket, { type: "auth", payload: { accessToken } });
    sendJson(socket, { type: "ping", payload: {} });
    expect(await close).toEqual({ code: 4401, reason: "Authenticate first." });
  });

  test("an invalid or tampered token is closed with 4401", async () => {
    const token = await loginToken();
    for (const accessToken of ["not-a-jwt", `${token}x`]) {
      const socket = await connect(app);
      const close = closed(socket);
      sendJson(socket, { type: "auth", payload: { accessToken } });
      expect((await close).code).toBe(4401);
    }
  });

  test("logout closes open connections of that session and rejects the token", async () => {
    const token = await loginToken();
    const { socket } = await authenticated(token);
    const close = closed(socket);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(204);
    expect(await close).toEqual({ code: 4401, reason: "Session ended." });

    const retry = await connect(app);
    const retryClose = closed(retry);
    sendJson(retry, { type: "auth", payload: { accessToken: token } });
    expect((await retryClose).code).toBe(4401);
  });

  test("the real gomoku engine refuses off-board moves as INVALID_ACTION", async () => {
    const realGomoku: RegisteredRules = {
      version: gomoku.GOMOKU_RULES_VERSION,
      rules: gomoku.rules,
      board: gomoku.board,
    };
    await app.close();
    app = await buildApp(
      {},
      testDatabaseUrl,
      { jwtSecret },
      undefined,
      {},
      {
        gomoku: realGomoku,
      },
    );
    const token = await loginToken(1);
    await loginToken(2);
    const matchId = await createGameCommandService(database.db, {
      gomoku: realGomoku,
    }).createMatch({ gameType: "gomoku", blackUserId: 1, whiteUserId: 2 });
    const { socket } = await authenticated(token);
    const next = inbox(socket);
    sendJson(socket, { type: "match.subscribe", payload: { matchId } });
    await next();

    // The DB allows only 0..14, so these must never reach insertMove.
    for (const [row, col] of [
      [15, 0],
      [-1, 0],
      [0, 15],
    ]) {
      sendJson(socket, {
        type: "game.command",
        payload: {
          matchId,
          gameType: "gomoku",
          commandId: randomUUID(),
          expectedVersion: 0,
          action: { type: "place", row, col },
        },
      });
      expect(await next()).toMatchObject({
        type: "game.error",
        payload: { code: "INVALID_ACTION" },
      });
    }
    socket.terminate();
  });

  test("refresh token reuse closes open connections of that session", async () => {
    const { accessToken, refreshToken } = await loginTokens();
    const { socket } = await authenticated(accessToken);
    const close = closed(socket);
    const refresh = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        payload: { refreshToken },
      });

    expect((await refresh()).statusCode).toBe(200);
    // The rotated token comes back: treated as stolen, the session is revoked.
    expect((await refresh()).statusCode).toBe(401);
    expect(await close).toEqual({ code: 4401, reason: "Session ended." });
  });

  describe("match subscription", () => {
    let sockets: WebSocket[];
    let matchA: number;
    let matchB: number;

    // p1 (black) vs p2 in match A, p3 (black) vs p4 in match B.
    beforeEach(async () => {
      const tokens = [];
      for (const n of [1, 2, 3, 4]) tokens.push(await loginToken(n));
      const games = createGameCommandService(database.db, {
        gomoku: stubGomoku,
      });
      matchA = await games.createMatch({
        gameType: "gomoku",
        blackUserId: 1,
        whiteUserId: 2,
      });
      matchB = await games.createMatch({
        gameType: "gomoku",
        blackUserId: 3,
        whiteUserId: 4,
      });
      sockets = [];
      for (const token of tokens) {
        sockets.push((await authenticated(token)).socket);
      }
    });
    afterEach(() => {
      for (const socket of sockets) socket.terminate();
    });

    function request(socket: WebSocket, type: string, payload: object) {
      const reply = nextMessage(socket);
      sendJson(socket, { type, requestId: "r1", payload });
      return reply;
    }

    test("a participant receives the match snapshot", async () => {
      expect(
        await request(sockets[0], "match.subscribe", { matchId: matchA }),
      ).toEqual({
        type: "match.snapshot",
        requestId: "r1",
        payload: expect.objectContaining({
          matchId: matchA,
          gameType: "gomoku",
          rulesVersion: "stub-1",
          stateVersion: 0,
          status: "playing",
          players: { black: 1, white: 2 },
          currentPlayerId: 1,
          result: null,
        }),
      });
    });

    test("players of two matches each get only their own snapshot", async () => {
      const replies = await Promise.all(
        sockets.map((socket, i) =>
          request(socket, "match.subscribe", {
            matchId: i < 2 ? matchA : matchB,
          }),
        ),
      );
      expect(
        replies.map(
          (r) => (r as { payload: { matchId: number } }).payload.matchId,
        ),
      ).toEqual([matchA, matchA, matchB, matchB]);
    });

    test("a non-participant, unknown or invalid match is refused", async () => {
      expect(
        await request(sockets[2], "match.subscribe", { matchId: matchA }),
      ).toMatchObject({
        type: "error",
        requestId: "r1",
        payload: { code: "NOT_PARTICIPANT", matchId: matchA },
      });
      expect(
        await request(sockets[0], "match.subscribe", { matchId: 9999 }),
      ).toMatchObject({ payload: { code: "NOT_FOUND", matchId: 9999 } });
      for (const matchId of [String(matchA), 0, -1, 1.5, null]) {
        expect(
          await request(sockets[0], "match.subscribe", { matchId }),
        ).toMatchObject({ payload: { code: "INVALID_MESSAGE" } });
      }
    });

    test("an unsubscribe sent right after subscribe is handled after it", async () => {
      const replies: unknown[] = [];
      sockets[0].on("message", (data) =>
        replies.push(JSON.parse(data.toString()).type),
      );
      sendJson(sockets[0], {
        type: "match.subscribe",
        payload: { matchId: matchA },
      });
      sendJson(sockets[0], {
        type: "match.unsubscribe",
        payload: { matchId: matchA },
      });
      await vi.waitFor(() => expect(replies).toHaveLength(2));
      expect(replies).toEqual(["match.snapshot", "match.unsubscribed"]);
    });

    test("unsubscribe is acknowledged", async () => {
      await request(sockets[0], "match.subscribe", { matchId: matchA });
      expect(
        await request(sockets[0], "match.unsubscribe", { matchId: matchA }),
      ).toEqual({
        type: "match.unsubscribed",
        requestId: "r1",
        payload: { matchId: matchA },
      });
    });

    describe("game commands", () => {
      let next: (() => Promise<unknown>)[];

      // p1·p2 watch match A, p3·p4 watch match B.
      beforeEach(async () => {
        next = sockets.map(inbox);
        for (const [i, socket] of sockets.entries()) {
          sendJson(socket, {
            type: "match.subscribe",
            payload: { matchId: i < 2 ? matchA : matchB },
          });
          await next[i]();
        }
      });

      function play(i: number, change: object = {}, commandId = randomUUID()) {
        sendJson(sockets[i], {
          type: "game.command",
          requestId: "c1",
          payload: {
            matchId: matchA,
            gameType: "gomoku",
            commandId,
            expectedVersion: 0,
            action: { type: "place", row: 7, col: 7 },
            ...change,
          },
        });
        return commandId;
      }

      // The next message after a ping proves nothing else was queued.
      async function expectNothingPending(i: number) {
        sendJson(sockets[i], { type: "ping", payload: {} });
        expect(await next[i]()).toMatchObject({ type: "pong" });
      }

      test("an applied move is acked to the sender and broadcast to the match only", async () => {
        const commandId = play(0);
        expect(await next[0]()).toEqual({
          type: "game.ack",
          requestId: "c1",
          payload: {
            matchId: matchA,
            commandId,
            stateVersion: 1,
            duplicate: false,
          },
        });
        for (const i of [0, 1]) {
          const update = (await next[i]()) as {
            type: string;
            payload: { board: unknown[][] };
          };
          expect(update).toMatchObject({
            type: "game.updated",
            payload: { matchId: matchA, stateVersion: 1, currentPlayerId: 2 },
          });
          expect(update.payload.board[7][7]).toBe("black");
        }
        for (const i of [0, 1, 2, 3]) await expectNothingPending(i);
      });

      test("a resent commandId is acked as duplicate and not broadcast again", async () => {
        const commandId = play(0);
        await next[0]();
        await next[0]();
        play(0, {}, commandId);
        expect(await next[0]()).toMatchObject({
          type: "game.ack",
          payload: { stateVersion: 1, duplicate: true },
        });
        expect(await next[1]()).toMatchObject({ type: "game.updated" });
        await expectNothingPending(0);
        await expectNothingPending(1);
      });

      test("a stale expectedVersion gets game.error and the latest snapshot", async () => {
        play(0);
        await next[1]();
        play(1, { action: { type: "place", row: 0, col: 0 } });
        expect(await next[1]()).toMatchObject({
          type: "game.error",
          requestId: "c1",
          payload: {
            code: "VERSION_CONFLICT",
            matchId: matchA,
            duplicate: false,
          },
        });
        expect(await next[1]()).toMatchObject({
          type: "match.snapshot",
          payload: { stateVersion: 1 },
        });
      });

      test("a rejected move is reported to the sender only", async () => {
        play(1);
        expect(await next[1]()).toMatchObject({
          type: "game.error",
          payload: { code: "NOT_YOUR_TURN" },
        });
        await expectNothingPending(0);
        await expectNothingPending(1);
      });

      test("resign finishes the match for both players", async () => {
        play(1, { action: { type: "resign" } });
        await next[1]();
        for (const i of [0, 1]) {
          expect(await next[i]()).toMatchObject({
            type: "game.updated",
            payload: {
              status: "finished",
              result: { outcome: "win", winnerId: 1, reason: "resign" },
            },
          });
        }
      });

      test("commands after the finish get a duplicate ack or GAME_FINISHED", async () => {
        const resignId = play(1, { action: { type: "resign" } });
        await next[1](); // game.ack
        await next[0](); // game.updated (finished)
        await next[1](); // game.updated (finished)

        // p2 resends the same resign (its ack was lost).
        play(1, { action: { type: "resign" } }, resignId);
        expect(await next[1]()).toMatchObject({
          type: "game.ack",
          payload: { duplicate: true },
        });
        for (const i of [1, 0]) {
          expect(await next[i]()).toMatchObject({ type: "game.updated" });
        }

        // p1 moves after the finish.
        play(0, { expectedVersion: 1 });
        expect(await next[0]()).toMatchObject({
          type: "game.error",
          payload: { code: "GAME_FINISHED" },
        });
      });

      test("a gameType that differs from the match is refused", async () => {
        play(0, { gameType: "othello" });
        expect(await next[0]()).toMatchObject({
          type: "error",
          payload: { code: "INVALID_MESSAGE", matchId: matchA },
        });
        await expectNothingPending(1);
      });

      test("an invalid command payload is refused before apply", async () => {
        play(0, { commandId: "not-a-uuid" });
        expect(await next[0]()).toMatchObject({
          type: "error",
          payload: { code: "INVALID_MESSAGE" },
        });
        await expectNothingPending(1);
      });

      test("commands need a subscription", async () => {
        sendJson(sockets[0], {
          type: "match.unsubscribe",
          payload: { matchId: matchA },
        });
        await next[0]();
        play(0);
        expect(await next[0]()).toMatchObject({
          type: "game.error",
          payload: { code: "NOT_SUBSCRIBED" },
        });
      });

      test("a newer subscription of the same user takes control", async () => {
        const { socket: tab2 } = await authenticated(await loginToken(1));
        sockets.push(tab2);
        next.push(inbox(tab2));
        sendJson(tab2, {
          type: "match.subscribe",
          payload: { matchId: matchA },
        });
        expect(await next[4]()).toMatchObject({ type: "match.snapshot" });
        expect(await next[0]()).toEqual({
          type: "session.replaced",
          payload: { matchId: matchA },
        });

        play(0);
        expect(await next[0]()).toMatchObject({
          type: "game.error",
          payload: { code: "SESSION_REPLACED" },
        });
        play(4);
        expect(await next[4]()).toMatchObject({ type: "game.ack" });
        // The replaced tab still watches the match.
        expect(await next[0]()).toMatchObject({ type: "game.updated" });
      });
    });
  });

  describe("matchmaking", () => {
    test("two queued players get the same new match and can subscribe", async () => {
      const players = [];
      for (const n of [1, 2]) {
        const { socket } = await authenticated(await loginToken(n));
        players.push({ socket, next: inbox(socket) });
      }
      const matched = [];
      for (const { socket, next } of players) {
        sendJson(socket, {
          type: "queue.join",
          requestId: "q1",
          payload: { gameType: "gomoku" },
        });
        expect(await next()).toEqual({
          type: "queue.joined",
          requestId: "q1",
          payload: { gameType: "gomoku" },
        });
      }
      for (const { next } of players) matched.push(await next());
      expect(matched[0]).toMatchObject({
        type: "queue.matched",
        payload: { gameType: "gomoku" },
      });
      expect(matched[1]).toEqual(matched[0]);
      const { matchId } = (matched[0] as { payload: { matchId: number } })
        .payload;

      const [p1] = players;
      sendJson(p1.socket, { type: "match.subscribe", payload: { matchId } });
      const snapshot = (await p1.next()) as {
        payload: { players: { black: number; white: number } };
      };
      expect(
        [snapshot.payload.players.black, snapshot.payload.players.white].sort(),
      ).toEqual([1, 2]);

      // Playing a match counts as active (DB check).
      sendJson(p1.socket, {
        type: "queue.join",
        payload: { gameType: "gomoku" },
      });
      expect(await p1.next()).toMatchObject({
        type: "error",
        payload: { code: "ALREADY_ACTIVE" },
      });
      for (const { socket } of players) socket.terminate();
    });

    test("invalid gameType is refused and leave is acknowledged", async () => {
      const { socket } = await authenticated(await loginToken());
      const next = inbox(socket);
      sendJson(socket, { type: "queue.join", payload: { gameType: "chess" } });
      expect(await next()).toMatchObject({
        type: "error",
        payload: { code: "INVALID_MESSAGE" },
      });
      // Known to the contract but no engine is registered.
      sendJson(socket, {
        type: "queue.join",
        payload: { gameType: "othello" },
      });
      expect(await next()).toMatchObject({
        type: "error",
        payload: { code: "INVALID_MESSAGE" },
      });
      sendJson(socket, { type: "queue.join", payload: { gameType: "gomoku" } });
      await next();
      sendJson(socket, { type: "queue.leave", requestId: "l1", payload: {} });
      expect(await next()).toEqual({
        type: "queue.left",
        requestId: "l1",
        payload: {},
      });
      socket.terminate();
    });
  });
});
