import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "../db/client.ts";

if (existsSync(".env")) loadEnvFile(".env");

// Integration tests run only when a separate test DB is configured.
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export async function openTestDatabase() {
  if (!testDatabaseUrl) throw new Error("Set TEST_DATABASE_URL.");
  // Tests wipe every table; never point them at the development DB.
  if (testDatabaseUrl === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL.");
  }
  const database = createDatabase(testDatabaseUrl);
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  return database;
}

export async function resetTestDatabase(
  database: Awaited<ReturnType<typeof openTestDatabase>>,
) {
  await database.db.execute(
    sql`TRUNCATE users, sessions, refresh_tokens, games, game_players, moves, game_commands RESTART IDENTITY CASCADE`,
  );
}
