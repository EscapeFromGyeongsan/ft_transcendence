import { EventEmitter, once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { pngHeader } from "../core/image.test.ts";
import { users } from "../db/schema/users.ts";
import { anonymizeUser } from "../repositories/account-repository.ts";
import { createAvatarService } from "../services/avatar-service.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

describe.skipIf(!testDatabaseUrl)(
  "profile writes racing account deletion with PostgreSQL",
  () => {
    let database: Awaited<ReturnType<typeof openTestDatabase>>;
    let app: FastifyInstance;
    let avatarDir: string;
    let bearer: string;
    let oldAvatar: string;
    let release: () => void;
    let entered: Promise<unknown>;

    beforeAll(async () => {
      database = await openTestDatabase();
    });
    afterAll(async () => {
      await app?.close();
      await database?.close();
      if (avatarDir) await rm(avatarDir, { recursive: true, force: true });
    });
    beforeEach(async () => {
      await app?.close();
      await resetTestDatabase(database);
      if (avatarDir) await rm(avatarDir, { recursive: true, force: true });
      avatarDir = await mkdtemp(join(tmpdir(), "deleted-profile-"));
      app = await buildApp(
        {},
        testDatabaseUrl,
        { jwtSecret: "test-secret-test-secret-test-secret" },
        avatarDir,
      );
      const events = new EventEmitter();
      entered = once(events, "authenticated");
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      app.addHook("preHandler", async (request) => {
        if (request.headers["x-test-hold"]) {
          expect(request.auth?.userId).toBe(1);
          events.emit("authenticated");
          await gate;
        }
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: {
              email: "profile-race@example.test",
              nickname: "profileRace",
              password: "password-123",
            },
          })
        ).statusCode,
      ).toBe(201);
      const loggedIn = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "profile-race@example.test",
          password: "password-123",
        },
      });
      bearer = loggedIn.json().accessToken;
      const saved = await createAvatarService(database.db, avatarDir).save(
        1,
        pngHeader(2, 2),
      );
      if (!saved.ok) throw new Error(saved.code);
      oldAvatar = saved.user.avatarUrl!;
    });

    for (const phase of ["after-commit", "waiting-on-row-lock"] as const) {
      test.each(["profile", "avatar-save", "avatar-remove"] as const)(
        `${phase}: previously authenticated %s cannot restore private data`,
        async (action) => {
          const body =
            action === "avatar-save"
              ? Buffer.concat([
                  Buffer.from(
                    '--race-boundary\r\nContent-Disposition: form-data; name="file"; filename="new.png"\r\nContent-Type: image/png\r\n\r\n',
                  ),
                  pngHeader(3, 3),
                  Buffer.from("\r\n--race-boundary--\r\n"),
                ])
              : undefined;
          const response = Promise.resolve(
            app.inject({
              method:
                action === "profile"
                  ? "PATCH"
                  : action === "avatar-save"
                    ? "PUT"
                    : "DELETE",
              url:
                action === "profile" ? "/api/users/me" : "/api/users/me/avatar",
              headers: {
                authorization: `Bearer ${bearer}`,
                "x-test-hold": "1",
                ...(body
                  ? {
                      "content-type":
                        "multipart/form-data; boundary=race-boundary",
                    }
                  : {}),
              },
              ...(action === "profile"
                ? {
                    payload: { nickname: "mustNotReturn" },
                  }
                : body
                  ? { payload: body }
                  : {}),
            }),
          );
          await entered;
          try {
            if (phase === "after-commit") {
              const deleted = await app.inject({
                method: "DELETE",
                url: "/api/users/me",
                headers: { authorization: `Bearer ${bearer}` },
                payload: { password: "password-123" },
              });
              expect(deleted.statusCode).toBe(204);
              release();
            } else {
              const client = await database.db.$client.connect();
              try {
                await client.query("BEGIN");
                await client.query(
                  "SELECT id FROM users WHERE id = 1 FOR UPDATE",
                );
                const {
                  rows: [{ pid }],
                } = await client.query<{ pid: number }>(
                  "SELECT pg_backend_pid() AS pid",
                );
                release();
                let blocked = false;
                const deadline = Date.now() + 1500;
                while (Date.now() < deadline) {
                  await client.query("SELECT pg_stat_clear_snapshot()");
                  const { rows } = await client.query<{ blocked: boolean }>(
                    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
                    [pid],
                  );
                  if (rows[0].blocked) {
                    blocked = true;
                    break;
                  }
                  await delay(10);
                }
                expect(
                  blocked,
                  "authenticated mutation must wait on the deletion's user lock",
                ).toBe(true);
                await anonymizeUser(drizzle(client), 1, new Date());
                await client.query("COMMIT");
                await createAvatarService(database.db, avatarDir).removeFile(
                  oldAvatar,
                );
              } finally {
                await client.query("ROLLBACK");
                client.release();
              }
            }
            expect.soft((await response).statusCode).toBe(401);
            const [user] = await database.db
              .select()
              .from(users)
              .where(eq(users.id, 1));
            expect.soft(user).toMatchObject({
              email: "deleted:1",
              nickname: "deleted:1",
              passwordHash: null,
              avatarUrl: null,
            });
            expect(user.deletedAt).not.toBeNull();
            expect.soft(await readdir(avatarDir)).toEqual([]);
          } finally {
            release();
            await response;
          }
        },
      );
    }
  },
);
