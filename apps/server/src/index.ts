import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { buildApp } from "./app.ts";
import { createDatabase } from "./db/client.ts";
import { gameEngines } from "./engines.ts";
import { readListenOptions } from "./listen-options.ts";
import { voidUnfinishedGames } from "./services/game-command-service.ts";

if (existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL in .env before starting the API server.");
}
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    "Set JWT_SECRET in .env to a random string of 32+ characters.",
  );
}
const twoFactorKey = process.env.TWO_FACTOR_KEY;
if (twoFactorKey !== undefined && twoFactorKey.length < 32) {
  throw new Error(
    "Set TWO_FACTOR_KEY in .env to a random string of 32+ characters.",
  );
}
const oauthEnv = [
  process.env.FT_OAUTH_CLIENT_ID,
  process.env.FT_OAUTH_CLIENT_SECRET,
  process.env.FT_OAUTH_REDIRECT_URI,
];
if (oauthEnv.some(Boolean) && !oauthEnv.every(Boolean)) {
  throw new Error(
    "Set all of FT_OAUTH_CLIENT_ID, FT_OAUTH_CLIENT_SECRET and FT_OAUTH_REDIRECT_URI, or none.",
  );
}
const [clientId, clientSecret, redirectUri] = oauthEnv;
const oauth42 =
  clientId && clientSecret && redirectUri
    ? { clientId, clientSecret, redirectUri }
    : undefined;
// PORT validation and the listen address live together. Containers set
// API_HOST=0.0.0.0; local development keeps the 127.0.0.1 default.
const listenOptions = readListenOptions();
// Client IP for rate limiting comes from X-Forwarded-For only when the direct
// peer is a trusted proxy. Default: loopback (local dev proxy). Behind the
// Docker Nginx set TRUST_PROXY=uniquelocal (private network addresses).
const trustProxy = process.env.TRUST_PROXY || "loopback";
const app = await buildApp(
  { trustProxy },
  process.env.DATABASE_URL,
  { jwtSecret, twoFactorKey, oauth42 },
  process.env.AVATAR_DIR || "data/avatars",
  {},
  gameEngines,
);
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
  const startup = createDatabase(process.env.DATABASE_URL);
  try {
    const voided = await voidUnfinishedGames(startup.db);
    if (voided.length > 0) {
      console.log(`Voided ${voided.length} unfinished match(es) on restart.`);
    }
  } finally {
    await startup.close();
  }
  const address = await app.listen(listenOptions);
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
