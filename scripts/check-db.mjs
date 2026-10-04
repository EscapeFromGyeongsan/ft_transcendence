import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { eq } from "drizzle-orm";
import { buildApp } from "../apps/server/src/app.ts";
import { createDatabase } from "../apps/server/src/db/client.ts";
import { connectionProbe } from "../apps/server/src/db/schema/connection-probe.ts";

if (existsSync(".env")) loadEnvFile(".env");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is missing.");
  const database = createDatabase(databaseUrl);
  try {
    await database.check();
    await database.db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.insert(connectionProbe).values({ id });
      const rows = await tx
        .select()
        .from(connectionProbe)
        .where(eq(connectionProbe.id, id));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, id);
      await tx.delete(connectionProbe).where(eq(connectionProbe.id, id));
    });
    console.log("PostgreSQL: Drizzle insert/read/delete succeeded.");
  } finally {
    await database.close();
  }

  const app = await buildApp({}, databaseUrl);
  try {
    const response = await app.inject({ method: "GET", url: "/api/health/db" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok", database: "ok" });
    console.log("Fastify: GET /api/health/db returned 200.");
  } finally {
    await app.close();
  }
}

try {
  await main();
} catch {
  console.error(
    "Database check failed. Check configuration, DB availability and migrations.",
  );
  process.exitCode = 1;
}
