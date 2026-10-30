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
import { currentStep, totpCode } from "../core/totp.ts";
import { savePendingSecret } from "../repositories/two-factor-repository.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

const config = {
  jwtSecret: "test-secret-test-secret-test-secret",
  twoFactorKey: "two-factor-key-two-factor-key-two-factor",
};
const account = {
  email: "p1@example.com",
  password: "password-123",
  nickname: "p1",
};
// Codes from adjacent steps are all accepted once, so each call can get a
// distinct valid code without waiting for the clock.
const codeAt = (secret: string, offset: number) =>
  totpCode(secret, currentStep() + offset);

test("2FA routes declare every status code in Swagger", async () => {
  const app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json()
    .paths;
  await app.close();
  const codes = (path: string, method: string) =>
    Object.keys(paths[path][method].responses).sort();
  expect(codes("/api/auth/2fa/verify", "post")).toEqual([
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
  expect(codes("/api/auth/2fa", "get")).toEqual(["200", "401", "500", "503"]);
  expect(codes("/api/auth/2fa/setup", "post")).toEqual([
    "200",
    "400",
    "401",
    "409",
    "413",
    "415",
    "500",
    "503",
  ]);
  expect(codes("/api/auth/2fa/enable", "post")).toEqual([
    "200",
    "400",
    "401",
    "409",
    "413",
    "415",
    "422",
    "429",
    "500",
    "503",
  ]);
  expect(codes("/api/auth/2fa/disable", "post")).toEqual([
    "204",
    "400",
    "401",
    "409",
    "413",
    "415",
    "422",
    "429",
    "500",
    "503",
  ]);
});

describe.skipIf(!testDatabaseUrl)("2FA with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;
  let token: string;

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
    app = await buildApp({}, testDatabaseUrl, config);
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: account,
    });
    token = (await login()).json().accessToken;
  });

  const login = () =>
    app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: account.email, password: account.password },
    });
  const post = (url: string, payload?: object) =>
    app.inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });
  const verify = (challengeToken: string, code: string) =>
    app.inject({
      method: "POST",
      url: "/api/auth/2fa/verify",
      payload: { challengeToken, code },
    });

  async function enable() {
    const setup = (await post("/api/auth/2fa/setup")).json();
    const enabled = await post("/api/auth/2fa/enable", {
      code: codeAt(setup.secret, 0),
    });
    return { secret: setup.secret as string, ...enabled.json() };
  }

  test("setup is inactive until a correct code confirms it", async () => {
    const setup = await post("/api/auth/2fa/setup");
    expect(setup.statusCode).toBe(200);
    expect(setup.json().otpauthUrl).toMatch(/^otpauth:\/\/totp\/.*secret=/);
    // Not enabled yet: login still returns tokens directly.
    expect((await login()).json()).toHaveProperty("accessToken");
    const wrong = await post("/api/auth/2fa/enable", { code: "000000" });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe("INVALID_TWO_FACTOR_CODE");

    const ok = await post("/api/auth/2fa/enable", {
      code: codeAt(setup.json().secret, 0),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().recoveryCodes).toHaveLength(10);
    const status = await app.inject({
      method: "GET",
      url: "/api/auth/2fa",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.json()).toEqual({ enabled: true });
    expect((await post("/api/auth/2fa/setup")).statusCode).toBe(409);
  });

  test("enable without setup returns 409", async () => {
    const response = await post("/api/auth/2fa/enable", { code: "123456" });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("TWO_FACTOR_NOT_SET_UP");
  });

  test("login of a 2FA account needs the second step", async () => {
    const { secret } = await enable();
    const first = (await login()).json();
    expect(first).toMatchObject({ twoFactorRequired: true, expiresIn: 300 });
    expect(first).not.toHaveProperty("accessToken");

    const wrong = await verify(first.challengeToken, "000000");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("INVALID_TWO_FACTOR_CODE");
    const ok = await verify(first.challengeToken, codeAt(secret, 1));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("accessToken");

    // The challenge is single use, and the code cannot be replayed.
    const reused = await verify(first.challengeToken, codeAt(secret, 1));
    expect(reused.json().error.code).toBe("UNAUTHENTICATED");
    const second = (await login()).json();
    expect(
      (await verify(second.challengeToken, codeAt(secret, 1))).json().error
        .code,
    ).toBe("INVALID_TWO_FACTOR_CODE");
  });

  test("a challenge is discarded after 5 wrong codes", async () => {
    const { secret } = await enable();
    const { challengeToken } = (await login()).json();
    for (let i = 0; i < 5; i += 1) await verify(challengeToken, "000000");
    const after = await verify(challengeToken, codeAt(secret, 1));
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("UNAUTHENTICATED");
  });

  test("recovery codes work once", async () => {
    const { recoveryCodes } = await enable();
    const first = (await login()).json();
    expect(
      (await verify(first.challengeToken, recoveryCodes[0].toLowerCase()))
        .statusCode,
    ).toBe(200);
    const second = (await login()).json();
    expect(
      (await verify(second.challengeToken, recoveryCodes[0])).statusCode,
    ).toBe(401);
  });

  test("disable needs a valid code and turns login back to one step", async () => {
    const { secret } = await enable();
    expect(
      (await post("/api/auth/2fa/disable", { code: "000000" })).statusCode,
    ).toBe(400);
    const ok = await post("/api/auth/2fa/disable", { code: codeAt(secret, 1) });
    expect(ok.statusCode).toBe(204);
    expect((await login()).json()).toHaveProperty("accessToken");
    const again = await post("/api/auth/2fa/disable", { code: "123456" });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("TWO_FACTOR_NOT_ENABLED");
  });

  test("2FA endpoints return 503 when TWO_FACTOR_KEY is not set", async () => {
    await app.close();
    app = await buildApp({}, testDatabaseUrl, { jwtSecret: config.jwtSecret });
    expect((await post("/api/auth/2fa/setup")).statusCode).toBe(503);
  });
  test("a late setup cannot reset an enabled secret (setup race)", async () => {
    await enable();
    // Simulates a setup request that saw no row before another request enabled 2FA.
    const saved = await savePendingSecret(database.db, 1, "replacement");
    expect(saved).toBe(false);
    const status = await app.inject({
      method: "GET",
      url: "/api/auth/2fa",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.json()).toEqual({ enabled: true });
  });
});
