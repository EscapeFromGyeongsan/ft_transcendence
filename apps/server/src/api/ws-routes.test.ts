import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { buildApp } from "../app.ts";
import { signAccessToken } from "../core/tokens.ts";
import { parseEnvelope, wsRateLimit } from "./ws-routes.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

const jwtSecret = "test-secret-test-secret-test-secret";
const account = {
  email: "p1@example.com",
  password: "password-123",
  nickname: "p1",
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
    app = await buildApp({}, testDatabaseUrl, { jwtSecret });
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  async function loginToken() {
    return (await loginTokens()).accessToken;
  }

  async function loginTokens() {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: account,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: account.email, password: account.password },
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
});
