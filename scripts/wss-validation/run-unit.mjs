import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createContainerDatabaseUrl } from "/app/apps/server/src/db/container-url.ts";
const password = await readFile(process.env.POSTGRES_PASSWORD_FILE, "utf8");
const databaseUrl = createContainerDatabaseUrl(
  process.env.POSTGRES_USER,
  "cafe_wss_unit_test",
  password,
);
const child = spawn("npm", ["test", "--", "--testTimeout=15000"], {
  cwd: "/app",
  stdio: "inherit",
  env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
