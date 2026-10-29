import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createContainerDatabaseUrl } from "../apps/server/src/db/container-url.ts";

const mode = process.argv[2];
if (mode !== "api" && mode !== "migrate") {
  throw new Error("Use container-start.mjs with api or migrate.");
}
const passwordPath = process.env.POSTGRES_PASSWORD_FILE;
if (!passwordPath) {
  throw new Error("Set POSTGRES_PASSWORD_FILE for the container.");
}
let passwordContents;
try {
  passwordContents = await readFile(passwordPath, "utf8");
} catch {
  throw new Error("Cannot read the database password file.");
}
process.env.DATABASE_URL = createContainerDatabaseUrl(
  process.env.POSTGRES_USER,
  process.env.POSTGRES_DB,
  passwordContents,
);

if (mode === "api") {
  // Import in this process so SIGTERM reaches the existing Fastify shutdown.
  await import("../apps/server/src/index.ts");
} else {
  const cli = fileURLToPath(
    new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    [cli, "migrate", "--config=config/drizzle.config.ts"],
    { stdio: "inherit", env: process.env },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  child.once("error", () => {
    console.error("Cannot start the migration process.");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
  });
}
