import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { createAuthService } from "../services/auth-service.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

// Pauses the next password check after it succeeds, before the session is created.
const hold = vi.hoisted(() => ({
  armed: false,
  entered: () => {},
  gate: Promise.resolve(),
}));
vi.mock("../core/password.ts", async (original) => {
  const real = await original<typeof import("../core/password.ts")>();
  return {
    ...real,
    async verifyPassword(hash: string, password: string) {
      const valid = await real.verifyPassword(hash, password);
      if (hold.armed) {
        hold.armed = false;
        hold.entered();
        await hold.gate;
      }
      return valid;
    },
  };
});

const config = { jwtSecret: "test-secret-test-secret-test-secret" };

describe.skipIf(!testDatabaseUrl)(
  "login racing account deletion with PostgreSQL (#156)",
  () => {
    let database: Awaited<ReturnType<typeof openTestDatabase>>;
    let app: FastifyInstance;

    beforeAll(async () => {
      database = await openTestDatabase();
    });
    afterAll(async () => {
      await app?.close();
      await database?.close();
    });
    beforeEach(async () => {
      await app?.close();
      await resetTestDatabase(database);
      app = await buildApp({}, testDatabaseUrl, config);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: {
              email: "race@example.test",
              nickname: "raceUser",
              password: "password-123",
            },
          })
        ).statusCode,
      ).toBe(201);
    });

    const login = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "race@example.test", password: "password-123" },
      });

    test("a login that finishes after deletion gets no session", async () => {
      const first = (await login()).json().accessToken as string;

      let release!: () => void;
      hold.gate = new Promise<void>((resolve) => (release = resolve));
      const entered = new Promise<void>((resolve) => (hold.entered = resolve));
      hold.armed = true;
      const late = login();
      await entered;

      const deletion = await app.inject({
        method: "DELETE",
        url: "/api/users/me",
        headers: { authorization: `Bearer ${first}` },
        payload: { password: "password-123" },
      });
      expect(deletion.statusCode).toBe(204);

      release();
      const response = await late;
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
      const [{ count }] = (
        await database.db.execute<{ count: number }>(
          sql`SELECT count(*)::int AS count FROM sessions WHERE revoked_at IS NULL`,
        )
      ).rows;
      expect(count).toBe(0);
    });

    test("completeLogin, shared by 42 OAuth and 2FA, refuses a deleted user", async () => {
      const first = (await login()).json().accessToken as string;
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: "/api/users/me",
            headers: { authorization: `Bearer ${first}` },
            payload: { password: "password-123" },
          })
        ).statusCode,
      ).toBe(204);
      expect(
        await createAuthService(database.db, config).completeLogin(1),
      ).toBeNull();
    });
  },
);
