import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL in .env before using Drizzle Kit.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/server/src/db/schema/*.ts",
  out: "./apps/server/drizzle",
  dbCredentials: { url: process.env.DATABASE_URL },
});
