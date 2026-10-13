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
  const database = createDatabase(testDatabaseUrl);
  // Tests wipe every table. Check the database actually connected to, not the
  // URL text (query strings or host aliases can point at the dev DB).
  const result = await database.db.execute<{ name: string }>(
    sql`SELECT current_database() AS name`,
  );
  const name = result.rows[0]?.name ?? "";
  if (!name.endsWith("_test")) {
    await database.close();
    throw new Error(
      `Refusing to run tests on database "${name}": its name must end with "_test".`,
    );
  }
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  return database;
}

export async function resetTestDatabase(
  database: Awaited<ReturnType<typeof openTestDatabase>>,
) {
  await database.db.execute(
    sql`TRUNCATE users, sessions, refresh_tokens, games, game_players, moves, game_commands, oauth_accounts, oauth_states, two_factor_secrets, two_factor_recovery_codes, two_factor_challenges RESTART IDENTITY CASCADE`,
  );
}
