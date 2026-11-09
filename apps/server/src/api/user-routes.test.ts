import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

const jwtSecret = "test-secret-test-secret-test-secret";

test("user routes declare every status code in Swagger", async () => {
  const app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json()
    .paths;
  await app.close();
  expect(Object.keys(paths["/api/users/me"].patch.responses).sort()).toEqual([
    "200",
    "400",
    "401",
    "409",
    "413",
    "415",
    "422",
    "500",
    "503",
  ]);
  expect(
    Object.keys(paths["/api/users/{userId}"].get.responses).sort(),
  ).toEqual(["200", "401", "404", "422", "500", "503"]);
});

describe.skipIf(!testDatabaseUrl)("user profile with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;
  let token: string;
  let otherId: number;

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
    app = await buildApp({}, testDatabaseUrl, { jwtSecret });
    for (const nickname of ["p1", "p2"]) {
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
    otherId = 2;
    token = (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "p1@example.com", password: "password-123" },
      })
    ).json().accessToken;
  });

  const patchNickname = (payload: unknown, auth = true) =>
    app.inject({
      method: "PATCH",
      url: "/api/users/me",
      headers: auth ? { authorization: `Bearer ${token}` } : {},
      payload: payload as object,
    });
  const profile = (id: string, auth = true) =>
    app.inject({
      method: "GET",
      url: `/api/users/${id}`,
      headers: auth ? { authorization: `Bearer ${token}` } : {},
    });

  test("nickname change succeeds, rejects duplicates and bad input", async () => {
    const ok = await patchNickname({ nickname: "새닉네임" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: 1, nickname: "새닉네임" });
    const taken = await patchNickname({ nickname: "p2" });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe("NICKNAME_TAKEN");
    expect((await patchNickname({ nickname: "a b" })).statusCode).toBe(422);
  });

  test("authentication is checked before body validation", async () => {
    const response = await patchNickname({ nickname: "" }, false);
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
    expect(
      (await patchNickname({ recordsPublic: "false" }, false)).statusCode,
    ).toBe(401);
  });

  test("records default to public and settings survive nickname changes and account reads", async () => {
    const getMe = () =>
      app.inject({
        method: "GET",
        url: "/api/users/me",
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await getMe()).json().recordsPublic).toBe(true);
    const updated = await patchNickname({ recordsPublic: false });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: 1,
      nickname: "p1",
      recordsPublic: false,
    });
    expect((await getMe()).json().recordsPublic).toBe(false);
    expect(
      (await patchNickname({ nickname: "new_name" })).json().recordsPublic,
    ).toBe(false);
    expect((await getMe()).json()).toMatchObject({
      nickname: "new_name",
      recordsPublic: false,
    });
    expect((await patchNickname({ recordsPublic: true })).json()).toMatchObject(
      { nickname: "new_name", recordsPublic: true },
    );
  });

  test("a duplicate nickname rolls back a combined privacy change", async () => {
    const rejected = await patchNickname({
      nickname: "p2",
      recordsPublic: false,
    });
    expect(rejected.statusCode).toBe(409);
    const me = await app.inject({
      method: "GET",
      url: "/api/users/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json()).toMatchObject({ nickname: "p1", recordsPublic: true });
    const saved = await patchNickname({
      nickname: "renamed",
      recordsPublic: false,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      nickname: "renamed",
      recordsPublic: false,
    });
  });

  test("privacy patches reject empty, unknown or coerced values without changing the account", async () => {
    for (const payload of [
      {},
      { unknown: true },
      { recordsPublic: "false" },
      { recordsPublic: "true" },
      { recordsPublic: null },
      { recordsPublic: 0 },
      { recordsPublic: 1 },
      { recordsPublic: [] },
      { recordsPublic: {} },
      { recordsPublic: false, userId: otherId },
    ]) {
      const response = await patchNickname(payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }
    const me = await app.inject({
      method: "GET",
      url: "/api/users/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json()).toMatchObject({ nickname: "p1", recordsPublic: true });
  });

  test("public profile hides email; unknown id 404, bad id 422", async () => {
    const other = await profile(String(otherId));
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual({
      id: otherId,
      nickname: "p2",
      avatarUrl: null,
    });
    expect((await profile("999")).statusCode).toBe(404);
    expect((await profile("abc")).statusCode).toBe(422);
    expect((await profile(String(otherId), false)).statusCode).toBe(401);
  });
  test("ids beyond the safe integer range are rejected with 422", async () => {
    expect((await profile("9007199254740993")).statusCode).toBe(422);
    expect((await profile("100000000000000000000")).statusCode).toBe(422);
  });
});
