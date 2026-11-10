import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { friendships } from "../db/schema/friendships.ts";
import { createFriendService } from "../services/friend-service.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

const jwtSecret = "test-secret-test-secret-test-secret";

test("friend routes document every response status in Swagger", async () => {
  const app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json().paths;
  const codes = (path: string, method: string) =>
    Object.keys(paths[path][method].responses).sort();
  expect(codes("/api/users", "get")).toEqual(["200", "401", "422", "429", "500", "503"]);
  expect(codes("/api/friends", "get")).toEqual(["200", "401", "500", "503"]);
  expect(codes("/api/friends/requests", "post")).toEqual([
    "200", "201", "400", "401", "404", "409", "413", "415", "422", "429", "500", "503",
  ]);
  expect(codes("/api/friends/requests/{requestId}/accept", "post")).toEqual([
    "200", "400", "401", "403", "404", "409", "413", "415", "422", "429", "500", "503",
  ]);
  expect(codes("/api/friends/requests/{requestId}/decline", "post")).toEqual([
    "204", "400", "401", "403", "404", "409", "413", "415", "422", "429", "500", "503",
  ]);
  expect(codes("/api/friends/{userId}", "delete")).toEqual([
    "204", "400", "401", "404", "413", "415", "422", "500", "503",
  ]);
  await app.close();
});

test("friend routes return 503 without database configuration", async () => {
  const app = await buildApp({}, undefined, { jwtSecret });
  const response = await app.inject({
    method: "GET", url: "/api/friends",
    headers: { authorization: "Bearer invalid" },
  });
  // Missing DB is detected during auth. No API data is exposed.
  expect(response.statusCode).toBe(503);
  await app.close();
});

describe.skipIf(!testDatabaseUrl)("friend REST with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;
  let tokens: string[];
  const nicknames = ["Alice", "Bob", "Carol"];

  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(database);
    await app?.close();
    app = await buildApp({}, testDatabaseUrl, { jwtSecret }, undefined, () => false);
    tokens = [];
    for (const name of nicknames) {
      const register = await app.inject({
        method: "POST", url: "/api/auth/register",
        payload: {
          email: `${name.toLowerCase()}@example.com`,
          nickname: name,
          password: "password-123",
        },
      });
      expect(register.statusCode).toBe(201);
      const login = await app.inject({
        method: "POST", url: "/api/auth/login",
        payload: {
          email: `${name.toLowerCase()}@example.com`,
          password: "password-123",
        },
      });
      tokens.push(login.json().accessToken);
    }
  });

  const call = (user: number, method: "GET" | "POST" | "DELETE", url: string, payload?: object) =>
    app.inject({
      method, url,
      headers: { authorization: `Bearer ${tokens[user - 1]}` },
      ...(payload ? { payload } : {}),
    });
  const send = (actor: number, target: number) =>
    call(actor, "POST", "/api/friends/requests", { userId: target });
  const accept = (actor: number, id: number) =>
    call(actor, "POST", `/api/friends/requests/${id}/accept`);
  const decline = (actor: number, id: number) =>
    call(actor, "POST", `/api/friends/requests/${id}/decline`);

  test("new request, lists, acceptance and deletion work across two accounts", async () => {
    const created = await send(1, 2);
    expect(created.statusCode).toBe(201);
    const id = created.json().requestId;
    expect(created.json()).toMatchObject({ userId: 2, nickname: "Bob", status: "pending" });
    expect((await call(1, "GET", "/api/friends")).json().outgoing)
      .toMatchObject([{ requestId: id, userId: 2 }]);
    expect((await call(2, "GET", "/api/friends")).json().incoming)
      .toMatchObject([{ requestId: id, userId: 1 }]);
    expect((await accept(1, id)).statusCode).toBe(403);
    expect((await accept(2, id)).json()).toMatchObject({
      userId: 1, requestId: id, status: "accepted",
    });
    const list = (await call(1, "GET", "/api/friends")).json();
    expect(list.friends).toMatchObject([{ userId: 2, online: false }]);
    expect(list.incoming).toEqual([]);
    expect(list.outgoing).toEqual([]);
    expect((await send(1, 2)).json().error.code).toBe("ALREADY_FRIENDS");
    expect((await call(1, "DELETE", "/api/friends/2")).statusCode).toBe(204);
    expect((await call(2, "DELETE", "/api/friends/1")).statusCode).toBe(404);
    expect((await send(2, 1)).statusCode).toBe(201);
  });

  test("opposite-direction request accepts pending relationship instead of creating a second row", async () => {
    const first = (await send(1, 2)).json();
    expect((await send(1, 2)).json().error.code).toBe("REQUEST_PENDING");
    const opposite = await send(2, 1);
    expect(opposite.statusCode).toBe(200);
    expect(opposite.json()).toMatchObject({
      requestId: first.requestId, status: "accepted", userId: 1,
    });
    expect(await database.db.select().from(friendships)).toHaveLength(1);
  });

  test("decline blocks the sender; recipient can initiate a new request with a NEW id", async () => {
    const first = (await send(1, 2)).json().requestId;
    expect((await decline(1, first)).statusCode).toBe(403);
    expect((await decline(2, first)).statusCode).toBe(204);
    expect((await send(1, 2)).json().error.code).toBe("REQUEST_DECLINED");
    expect((await call(1, "DELETE", "/api/friends/2")).statusCode).toBe(404);
    const second = await send(2, 1);
    expect(second.statusCode).toBe(201);
    const newId = second.json().requestId;
    expect(newId).not.toBe(first);
    expect((await accept(2, first)).statusCode).toBe(404);
    expect((await decline(2, first)).statusCode).toBe(404);
    expect((await accept(1, newId)).statusCode).toBe(200);
  });

  test("already-handled request cannot be accepted or declined again", async () => {
    const id = (await send(1, 2)).json().requestId;
    expect((await accept(2, id)).statusCode).toBe(200);
    expect((await accept(2, id)).statusCode).toBe(409);
    expect((await decline(2, id)).statusCode).toBe(409);
    expect((await accept(3, id)).statusCode).toBe(403);
  });

  test("validation, auth and user discovery do not expose private fields", async () => {
    expect((await send(1, 1)).statusCode).toBe(422);
    expect((await send(1, 9999)).statusCode).toBe(404);
    expect((await call(1, "POST", "/api/friends/requests", { userId: 1, unexpected: true })).statusCode).toBe(422);
    const search = await call(1, "GET", "/api/users?nickname=bo");
    expect(search.json()).toEqual([{ id: 2, nickname: "Bob", avatarUrl: null }]);
    expect(search.body).not.toContain("email");
    expect((await call(1, "GET", "/api/users?nickname=%25")).json()).toEqual([]);
    expect((await call(1, "GET", "/api/users?nickname=")).statusCode).toBe(422);
    expect((await app.inject({ method: "GET", url: "/api/friends" })).statusCode).toBe(401);
    expect((await call(1, "POST", "/api/friends/requests/abc/accept")).statusCode).toBe(422);
  });

  test("simultaneous opposite requests produce one pair; stale action is rejected", async () => {
    const responses = await Promise.all([send(1, 2), send(2, 1)]);
    expect(responses.every((r) => [200, 201].includes(r.statusCode))).toBe(true);
    const rows = await database.db.select().from(friendships);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("accepted");
    const id = rows[0].id;
    expect((await decline(1, id)).statusCode).toBe(409);
    expect((await decline(2, id)).statusCode).toBe(409);
  });

  test("two racing accepts and declines resolve one outcome under row lock", async () => {
    const id = (await send(1, 2)).json().requestId;
    const responses = await Promise.all([accept(2, id), decline(2, id)]);
    expect(responses.filter((r) => [200, 204].includes(r.statusCode))).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(1);
    const [row] = await database.db.select().from(friendships).where(eq(friendships.id, id));
    expect(["accepted", "declined"]).toContain(row.status);
  });

  test("unbound online registry does not falsely report friends as offline", async () => {
    const id = (await send(1, 2)).json().requestId;
    await accept(2, id);
    const unbound = createFriendService(database.db);
    await expect(unbound.getFriends(1)).rejects.toThrow();
  });

  test("accepted friend ID query only includes accepted relationships", async () => {
    const service = createFriendService(database.db);
    const first = (await send(1, 2)).json().requestId;
    await accept(2, first);
    await send(1, 3);
    expect(await service.listAcceptedFriendIds(1)).toEqual([2]);
  });
});
