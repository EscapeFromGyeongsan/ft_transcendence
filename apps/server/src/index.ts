import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { buildApp } from "./app.ts";

if (existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL in .env before starting the API server.");
}
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Set PORT in .env to an integer between 1 and 65535.");
}
const app = await buildApp({}, process.env.DATABASE_URL);
try {
  const databaseHealth = await app.inject({
    method: "GET",
    url: "/api/health/db",
  });
  if (databaseHealth.statusCode !== 200) {
    throw new Error(
      "Database is unavailable. Run npm run db:up and npm run db:migrate first.",
    );
  }
  const address = await app.listen({
    port,
    host: "127.0.0.1",
  });
  console.log(`Fastify API listening on ${address}`);
} catch (error) {
  await app.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
