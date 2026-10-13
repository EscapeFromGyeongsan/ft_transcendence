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
const account = {
  email: "p1@example.com",
  password: "password-123",
  nickname: "p1",
};

test("auth routes declare every status code in Swagger", async () => {
  const app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json()
    .paths;
  await app.close();
  expect(
    Object.keys(paths["/api/auth/register"].post.responses).sort(),
  ).toEqual(["201", "400", "409", "413", "415", "422", "429", "500", "503"]);
  expect(Object.keys(paths["/api/auth/login"].post.responses).sort()).toEqual([
    "200",
    "400",
    "401",
    "413",
    "415",
    "422",
    "429",
    "500",
    "503",
  ]);
  expect(Object.keys(paths["/api/auth/refresh"].post.responses).sort()).toEqual(
    ["200", "400", "401", "413", "415", "422", "429", "500", "503"],
  );
  expect(Object.keys(paths["/api/auth/logout"].post.responses).sort()).toEqual([
    "204",
    "400",
    "401",
    "413",
    "415",
    "500",
    "503",
  ]);
  expect(Object.keys(paths["/api/users/me"].get.responses).sort()).toEqual([
    "200",
    "401",
    "500",
    "503",
  ]);
});

test("auth routes return 503 when no database is configured", async () => {
  const app = await buildApp({}, undefined, { jwtSecret });
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: account.email, password: account.password },
  });
  await app.close();
  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
});

describe.skipIf(!testDatabaseUrl)("auth with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await database?.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(database);
    await app?.close();
    app = await buildApp({}, testDatabaseUrl, { jwtSecret });
  });
  afterAll(async () => {
    await app?.close();
  });

  const register = (payload: object) =>
    app.inject({ method: "POST", url: "/api/auth/register", payload });
  const login = (payload: object) =>
    app.inject({ method: "POST", url: "/api/auth/login", payload });
  const refresh = (refreshToken: string) =>
    app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken },
    });
  const me = (accessToken?: string) =>
    app.inject({
      method: "GET",
      url: "/api/users/me",
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });

  test("register stores the account without exposing the password", async () => {
    const response = await register(account);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: 1,
      email: account.email,
      nickname: "p1",
      avatarUrl: null,
    });
    expect(response.body).not.toContain("password");
  });

  test("duplicate email (case-insensitive) and nickname return 409", async () => {
    await register(account);
    const email = await register({
      ...account,
      email: "P1@Example.com",
      nickname: "p2",
    });
    expect(email.statusCode).toBe(409);
    expect(email.json().error.code).toBe("EMAIL_TAKEN");
    const nickname = await register({ ...account, email: "p2@example.com" });
    expect(nickname.statusCode).toBe(409);
    expect(nickname.json().error.code).toBe("NICKNAME_TAKEN");
  });

  test("invalid body returns 422, malformed JSON 400, wrong content type 415", async () => {
    const invalid = await register({
      email: "not-an-email",
      password: "short",
      nickname: "a b",
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
    const malformed = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("BAD_REQUEST");
    const text = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { "content-type": "text/plain" },
      payload: "hello",
    });
    expect(text.statusCode).toBe(415);
    expect(text.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  test("login checks credentials and the token reaches /users/me", async () => {
    await register(account);
    const wrong = await login({
      email: account.email,
      password: "wrong-password",
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("INVALID_CREDENTIALS");
    const unknown = await login({
      email: "nobody@example.com",
      password: account.password,
    });
    expect(unknown.statusCode).toBe(401);

    const ok = await login({
      email: "P1@example.com",
      password: account.password,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ tokenType: "Bearer", expiresIn: 1800 });
    const profile = await me(ok.json().accessToken);
    expect(profile.statusCode).toBe(200);
    expect(profile.json().email).toBe(account.email);
    expect((await me()).statusCode).toBe(401);
    expect((await me("garbage")).statusCode).toBe(401);
  });

  test("refresh rotates the token and reuse revokes the session", async () => {
    await register(account);
    const first = (await login(account)).json();
    const second = await refresh(first.refreshToken);
    expect(second.statusCode).toBe(200);
    const rotated = second.json();
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect((await me(rotated.accessToken)).statusCode).toBe(200);

    // Replaying the old token looks like theft: the whole session is revoked.
    const replay = await refresh(first.refreshToken);
    expect(replay.statusCode).toBe(401);
    expect((await refresh(rotated.refreshToken)).statusCode).toBe(401);
    expect((await me(rotated.accessToken)).statusCode).toBe(401);
    expect((await refresh("unknown-token")).statusCode).toBe(401);
  });

  test("logout rejects the same access and refresh tokens afterwards", async () => {
    await register(account);
    const tokens = (await login(account)).json();
    const other = (await login(account)).json();
    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(logout.statusCode).toBe(204);
    expect((await me(tokens.accessToken)).statusCode).toBe(401);
    expect((await refresh(tokens.refreshToken)).statusCode).toBe(401);
    // Only the current session ends; another device stays signed in.
    expect((await me(other.accessToken)).statusCode).toBe(200);
  });

  test("login is rate limited per client", async () => {
    const attempt = () =>
      login({ email: account.email, password: "wrong-password" });
    for (let i = 0; i < 10; i += 1)
      expect((await attempt()).statusCode).toBe(401);
    const limited = await attempt();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
  });
  test("a body over 1 MiB returns 413, not 500", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: account.email, password: "x".repeat(1_100_000) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("a POST that takes no body still answers 400 for broken JSON", async () => {
    await register(account);
    const { accessToken } = (await login(account)).json();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      payload: "{",
    });
    expect(response.statusCode).toBe(400);
  });
});
