import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { openTestDatabase, testDatabaseUrl } from "../test-support/database.ts";

const caseMigration = readFileSync(
  new URL("../../drizzle/0007_case_insensitive_nickname.sql", import.meta.url),
  "utf8",
);
const normalizedMigration = readFileSync(
  new URL("../../drizzle/0008_normalized_nickname.sql", import.meta.url),
  "utf8",
);

async function applyMigration(client: pg.Client, migration: string) {
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

async function withLegacyUsers(check: (client: pg.Client) => Promise<void>) {
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    // migration의 테이블·인덱스 이름은 임시 스키마에서만 찾아 공유 테스트 표를 보호합니다.
    await client.query("SET LOCAL search_path TO pg_temp");
    await client.query(`CREATE TEMP TABLE users (
      nickname varchar(32) NOT NULL CONSTRAINT users_nickname_unique UNIQUE
    ) ON COMMIT DROP`);
    await check(client);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

describe.skipIf(!testDatabaseUrl)(
  "nickname migration upgrade with PostgreSQL",
  () => {
    let database: Awaited<ReturnType<typeof openTestDatabase>>;
    beforeAll(async () => {
      database = await openTestDatabase();
    });
    afterAll(async () => {
      await database?.close();
    });

    test("0008 rejects a canonical duplicate of a nickname stored before 0007", async () => {
      await withLegacyUsers(async (client) => {
        const legacy = "가나".normalize("NFD");
        await client.query("INSERT INTO users (nickname) VALUES ($1)", [
          legacy,
        ]);
        await applyMigration(client, caseMigration);
        await applyMigration(client, normalizedMigration);
        const duplicate = await client.query(
          "INSERT INTO users (nickname) VALUES ($1) ON CONFLICT DO NOTHING RETURNING nickname",
          ["가나"],
        );
        expect(duplicate.rowCount).toBe(0);
        expect((await client.query("SELECT nickname FROM users")).rows).toEqual(
          [{ nickname: legacy }],
        );
      });
    });

    test("a preexisting canonical collision fails without discarding accounts or the old index", async () => {
      await withLegacyUsers(async (client) => {
        await client.query("INSERT INTO users (nickname) VALUES ($1), ($2)", [
          "가나".normalize("NFD"),
          "가나",
        ]);
        await applyMigration(client, caseMigration);
        await client.query("SAVEPOINT normalized_index");
        await expect(
          applyMigration(client, normalizedMigration),
        ).rejects.toMatchObject({ code: "23505" });
        await client.query("ROLLBACK TO SAVEPOINT normalized_index");
        expect(
          (await client.query("SELECT nickname FROM users")).rowCount,
        ).toBe(2);
        const index = await client.query(`SELECT indexdef FROM pg_indexes
        WHERE schemaname = (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema())
          AND indexname = 'users_nickname_unique'`);
        expect(index.rows[0]?.indexdef).toContain("lower");
        expect(index.rows[0]?.indexdef).not.toContain("normalize");
      });
    });
  },
);
