import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { setTimeout as delay } from "node:timers/promises";
import type { PoolClient } from "pg";
import { friendships } from "../db/schema/friendships.ts";
import { sessions, users } from "../db/schema/users.ts";
import { anonymizeUser } from "../repositories/account-repository.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";
import { createAccountService } from "./account-service.ts";
import { createFriendService } from "./friend-service.ts";

describe.skipIf(!testDatabaseUrl)(
  "friendships and soft deletion with PostgreSQL",
  () => {
    let database: Awaited<ReturnType<typeof openTestDatabase>>;
    let friends: ReturnType<typeof createFriendService>;
    let sessionIds: string[];

    beforeAll(async () => {
      database = await openTestDatabase();
    });
    afterAll(async () => {
      await database?.close();
    });
    beforeEach(async () => {
      await resetTestDatabase(database);
      await database.db.insert(users).values(
        Array.from({ length: 6 }, (_, i) => ({
          email: `friend${i + 1}@example.test`,
          nickname: `friend${i + 1}`,
        })),
      );
      const rows = await database.db
        .insert(sessions)
        .values(
          Array.from({ length: 6 }, (_, i) => ({
            userId: i + 1,
            expiresAt: new Date(Date.now() + 3600_000),
          })),
        )
        .returning({ id: sessions.id });
      sessionIds = rows.map((row) => row.id);
      friends = createFriendService(database.db, () => false);
    });

    const removeAccount = (userId: number) =>
      createAccountService(database.db).deleteAccount(
        userId,
        sessionIds[userId - 1],
        {},
      );
    async function pending() {
      const result = await friends.requestFriend(1, 2);
      if (!result.ok) throw new Error(result.code);
      return result.result.requestId;
    }

    async function waitForBlockedBy(client: PoolClient, pid: number) {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        // The held transaction must see backends opened after its first poll.
        await client.query("SELECT pg_stat_clear_snapshot()");
        const { rows } = await client.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
          [pid],
        );
        if (rows.length) return rows[0].pid;
        await delay(10);
      }
      throw new Error("Expected an actual PostgreSQL lock wait");
    }

    test("deletion removes every relationship status atomically and reports peers after commit", async () => {
      await database.db.insert(friendships).values([
        {
          userLowId: 1,
          userHighId: 2,
          requestedById: 1,
          status: "accepted",
          acceptedAt: new Date(),
        },
        { userLowId: 1, userHighId: 3, requestedById: 1 },
        { userLowId: 1, userHighId: 4, requestedById: 4 },
        {
          userLowId: 1,
          userHighId: 5,
          requestedById: 1,
          status: "declined",
          declinedAt: new Date(),
        },
        {
          userLowId: 2,
          userHighId: 6,
          requestedById: 2,
          status: "accepted",
          acceptedAt: new Date(),
        },
      ]);
      const committedReads: Promise<unknown>[] = [];
      const changed = vi.fn((userId: number, ids: number[]) => {
        expect(userId).toBe(1);
        expect([...ids].sort()).toEqual([2, 3, 4, 5]);
        committedReads.push(
          friends.getFriends(2).then((list) => {
            expect(list.friends.map((friend) => friend.userId)).toEqual([6]);
          }),
        );
      });
      const account = createAccountService(
        database.db,
        undefined,
        undefined,
        undefined,
        changed,
      );
      expect(await account.deleteAccount(1, sessionIds[0], {})).toEqual({
        ok: true,
      });
      await Promise.all(committedReads);
      expect(changed).toHaveBeenCalledOnce();
      expect(await database.db.select().from(friendships)).toMatchObject([
        { userLowId: 2, userHighId: 6 },
      ]);
      expect(await friends.getFriends(3)).toEqual({
        friends: [],
        incoming: [],
        outgoing: [],
      });
      expect(await friends.getFriends(4)).toEqual({
        friends: [],
        incoming: [],
        outgoing: [],
      });
      expect(await friends.requestFriend(2, 1)).toEqual({
        ok: false,
        code: "USER_NOT_FOUND",
      });
      expect(await account.deleteAccount(1, sessionIds[0], {})).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(changed).toHaveBeenCalledOnce();
    });

    test("legacy relationships never expose or accept a soft-deleted user", async () => {
      const id = await pending();
      await database.db.insert(friendships).values([
        { userLowId: 1, userHighId: 3, requestedById: 3 },
        {
          userLowId: 1,
          userHighId: 4,
          requestedById: 1,
          status: "accepted",
          acceptedAt: new Date(),
        },
      ]);
      await database.db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, 1));
      for (const userId of [2, 3, 4])
        expect(await friends.getFriends(userId)).toEqual({
          friends: [],
          incoming: [],
          outgoing: [],
        });
      expect(await friends.searchUsers(2, "friend1")).toEqual([]);
      expect(await friends.listAcceptedFriendIds(1)).toEqual([]);
      expect(await friends.listAcceptedFriendIds(4)).toEqual([]);
      expect(await friends.requestFriend(2, 1)).toEqual({
        ok: false,
        code: "USER_NOT_FOUND",
      });
      expect(await friends.requestFriend(1, 5)).toEqual({
        ok: false,
        code: "USER_NOT_FOUND",
      });
      expect(await friends.decide(2, id, "accept")).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(await friends.decide(2, id, "decline")).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    });

    test("rollback restores relationships and emits no post-commit notification", async () => {
      await pending();
      const changed = vi.fn();
      const revoked = vi.fn();
      await database.db.execute(sql`
      CREATE FUNCTION test_reject_anonymization() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test deletion rollback'; END; $$`);
      await database.db.execute(sql`
      CREATE TRIGGER test_reject_anonymization BEFORE UPDATE OF deleted_at ON users
      FOR EACH ROW EXECUTE FUNCTION test_reject_anonymization()`);
      try {
        const account = createAccountService(
          database.db,
          undefined,
          undefined,
          revoked,
          changed,
        );
        await expect(
          account.deleteAccount(1, sessionIds[0], {}),
        ).rejects.toThrow();
        expect(await database.db.select().from(friendships)).toHaveLength(1);
        const [user] = await database.db
          .select()
          .from(users)
          .where(eq(users.id, 1));
        expect(user.deletedAt).toBeNull();
        const [session] = await database.db
          .select()
          .from(sessions)
          .where(eq(sessions.id, sessionIds[0]));
        expect(session.revokedAt).toBeNull();
        expect(changed).not.toHaveBeenCalled();
        expect(revoked).not.toHaveBeenCalled();
      } finally {
        await database.db.execute(
          sql`DROP FUNCTION test_reject_anonymization() CASCADE`,
        );
      }
    });

    test.each([
      "request-target",
      "request-actor",
      "accept-sender",
      "accept-recipient",
      "decline-sender",
    ])("deletion wins the user lock before %s", async (scenario) => {
      const id = await pending();
      const userId =
        scenario === "accept-sender" || scenario === "decline-sender" ? 1 : 2;
      const client = await database.db.$client.connect();
      let action: Promise<unknown> | undefined;
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
          userId,
        ]);
        const {
          rows: [{ pid }],
        } = await client.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        action = scenario.startsWith("request")
          ? friends.requestFriend(
              scenario === "request-actor" ? 2 : 1,
              scenario === "request-actor" ? 1 : 2,
            )
          : friends.decide(
              2,
              id,
              scenario.startsWith("decline") ? "decline" : "accept",
            );
        await waitForBlockedBy(client, pid);
        await anonymizeUser(drizzle(client), userId, new Date());
        await client.query("COMMIT");
        expect(await action).toEqual({
          ok: false,
          code: scenario.startsWith("request") ? "USER_NOT_FOUND" : "NOT_FOUND",
        });
        expect(await database.db.select().from(friendships)).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
        client.release();
        await action;
      }
    });

    test.each(["request", "accept", "decline"] as const)(
      "%s holds user shares before deletion and cannot resurrect the relation",
      async (scenario) => {
        const id = await pending();
        const client = await database.db.$client.connect();
        let mutation: Promise<unknown> | undefined;
        let deletion: Promise<unknown> | undefined;
        try {
          await client.query("BEGIN");
          await client.query(
            "SELECT id FROM friendships WHERE id = $1 FOR UPDATE",
            [id],
          );
          const {
            rows: [{ pid }],
          } = await client.query<{ pid: number }>(
            "SELECT pg_backend_pid() AS pid",
          );
          mutation =
            scenario === "request"
              ? friends.requestFriend(2, 1)
              : friends.decide(2, id, scenario);
          const mutationPid = await waitForBlockedBy(client, pid);
          deletion = removeAccount(2);
          await waitForBlockedBy(client, mutationPid);
          await client.query("COMMIT");
          expect(await mutation).toMatchObject({ ok: true });
          expect(await deletion).toEqual({ ok: true });
          expect(await database.db.select().from(friendships)).toEqual([]);
          expect(await friends.requestFriend(1, 2)).toEqual({
            ok: false,
            code: "USER_NOT_FOUND",
          });
        } finally {
          await client.query("ROLLBACK");
          client.release();
          await Promise.allSettled([mutation, deletion]);
        }
      },
    );
  },
);
