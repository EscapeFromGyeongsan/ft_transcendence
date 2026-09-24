import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir, readFile } from "node:fs/promises";

export interface Database {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

/** Same PostgreSQL schema for an external server and the local embedded engine. */
export async function openDatabase(
  options: { url?: string; directory?: string } = {},
): Promise<Database> {
  let db: Database;
  if (options.url) {
    const pool = new pg.Pool({ connectionString: options.url, max: 5 });
    db = {
      query: (sql, parameters) => pool.query(sql, parameters),
      close: () => pool.end(),
    };
  } else {
    if (options.directory) await mkdir(options.directory, { recursive: true });
    const engine = new PGlite(options.directory);
    db = {
      query: (sql, parameters) => engine.query(sql, parameters),
      close: () => engine.close(),
    };
  }
  try {
    for (const file of ["001-auth.sql", "002-matches.sql"]) {
      const migration = await readFile(
        new URL(`./${file}`, import.meta.url),
        "utf8",
      );
      for (const statement of migration
        .split(";")
        .filter((value) => value.trim()))
        await db.query(statement);
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
