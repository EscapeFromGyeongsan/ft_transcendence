import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { connectionProbe } from "./schema/connection-probe.ts";

export function createDatabase(
  connectionString: string,
  onPoolError: () => void = () => {
    console.error("Database pool connection lost.");
  },
) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
  });
  // Idle clients can emit errors outside a request. Never log credentials/SQL.
  pool.on("error", onPoolError);
  const db = drizzle(pool);

  return {
    db,
    async check() {
      // An empty result is healthy: this also checks that migration was applied.
      await db
        .select({ id: connectionProbe.id })
        .from(connectionProbe)
        .limit(1);
    },
    close: () => pool.end(),
  };
}
