import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { buildApp } from "./app.ts";

import { openDatabase } from "./db/database.ts";

if (existsSync(".env")) loadEnvFile(".env");
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.DATABASE_URL || !process.env.APP_ORIGIN?.startsWith("https://"))
) {
  throw new Error("Production requires DATABASE_URL and an HTTPS APP_ORIGIN");
}
const database = await openDatabase({
  url: process.env.DATABASE_URL,
  directory: process.env.DATABASE_DIR ?? "./data/accounts",
});
const app = await buildApp(undefined, {
  database,
  origin: process.env.APP_ORIGIN ?? "http://127.0.0.1:5173",
  secureCookies: production,
});
app.addHook("onClose", async () => {
  await database.close();
});
const address = await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: "127.0.0.1",
});
console.log(`Fastify Omok API listening on ${address}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
