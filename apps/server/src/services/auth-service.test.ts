import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { verifyAccessToken } from "../core/tokens.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";
import { createAuthService, type TokenPair } from "./auth-service.ts";

const jwtSecret = "test-secret-test-secret-test-secret";
const account = {
  email: "p1@example.com",
  password: "password-123",
  nickname: "p1",
};

describe.skipIf(!testDatabaseUrl)("auth service session revocation", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let revoked: string[];
  let auth: ReturnType<typeof createAuthService>;

  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await database?.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(database);
    revoked = [];
    auth = createAuthService(database.db, { jwtSecret }, undefined, (id) =>
      revoked.push(id),
    );
    await auth.register(account);
  });

  const login = async () => (await auth.login(account)) as TokenPair;
  const sessionOf = (tokens: TokenPair) =>
    verifyAccessToken(tokens.accessToken, jwtSecret)!.sessionId;

  test("refresh-token reuse reports the revoked session once", async () => {
    const first = await login();
    await auth.refresh(first.refreshToken);
    expect(revoked).toEqual([]);

    expect(await auth.refresh(first.refreshToken)).toBeNull();
    expect(revoked).toEqual([sessionOf(first)]);

    // Replaying again finds the session already revoked.
    await auth.refresh(first.refreshToken);
    expect(revoked).toHaveLength(1);
  });

  test("logout, unknown tokens and normal rotation report nothing", async () => {
    const tokens = await login();
    await auth.refresh("unknown-token");
    await auth.logout(sessionOf(tokens));
    expect(await auth.refresh(tokens.refreshToken)).toBeNull();
    expect(revoked).toEqual([]);
  });
});
