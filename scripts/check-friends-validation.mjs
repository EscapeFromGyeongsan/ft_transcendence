import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { buildApp } from "../apps/server/src/app.ts";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Use a NEW, disposable database: this script checks the 0003 upgrade path.
const root = fileURLToPath(new URL("../", import.meta.url));
const url = process.env.TEST_DATABASE_URL;
assert(
  url && new URL(url).pathname.endsWith("_test"),
  "Set TEST_DATABASE_URL to a fresh database whose name ends with _test.",
);
const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool);
const temp = await mkdtemp(join(tmpdir(), "pr95-migrations-"));
let app;
try {
  assert.equal(
    (
      await pool.query("SELECT current_database() AS name")
    ).rows[0].name.endsWith("_test"),
    true,
  );
  const existing = await pool.query(
    "SELECT to_regclass('public.users') AS users, to_regclass('drizzle.__drizzle_migrations') AS migrations",
  );
  assert.deepEqual(
    existing.rows[0],
    { users: null, migrations: null },
    "Use a fresh database; this script refuses an already initialized database.",
  );
  await mkdir(join(temp, "meta"));
  const journal = JSON.parse(
    await readFile(`${root}/apps/server/drizzle/meta/_journal.json`),
  );
  const baseline = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx < 4),
  };
  await writeFile(join(temp, "meta/_journal.json"), JSON.stringify(baseline));
  for (const entry of baseline.entries)
    await copyFile(
      `${root}/apps/server/drizzle/${entry.tag}.sql`,
      join(temp, `${entry.tag}.sql`),
    );
  await migrate(db, { migrationsFolder: temp });
  await pool.query(
    "INSERT INTO users (email, nickname) VALUES ('preserved@example.com', 'PreservedUser')",
  );
  const before = (await pool.query("SELECT * FROM users ORDER BY id")).rows;
  await migrate(db, { migrationsFolder: `${root}/apps/server/drizzle` });
  assert.deepEqual(
    (await pool.query("SELECT * FROM users ORDER BY id")).rows,
    before,
  );
  await migrate(db, { migrationsFolder: `${root}/apps/server/drizzle` });
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM drizzle.__drizzle_migrations"))
        .rows[0].count,
    ),
    5,
  );
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM friendships")).rows[0].count,
    ),
    0,
  );
  console.log(
    "PASS: 0003 to 0004 migration preserves existing user data; second migrate is idempotent.",
  );
  app = await buildApp(
    {},
    url,
    { jwtSecret: "pr95-http-validation-secret-at-least-32-characters" },
    undefined,
    undefined,
    (id) => id === 3,
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function http(method, path, token, payload) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
    };
  }
  const tokens = [];
  for (const name of ["HttpAlice", "HttpBob"]) {
    const credentials = {
      email: `${name}@example.com`,
      password: "http-validation-password",
      nickname: name,
    };
    assert.equal(
      (await http("POST", "/api/auth/register", null, credentials)).status,
      201,
    );
    const login = await http("POST", "/api/auth/login", null, {
      email: credentials.email,
      password: credentials.password,
    });
    assert.equal(login.status, 200);
    tokens.push(login.body.accessToken);
  }
  assert.equal((await http("GET", "/api/friends")).status, 401);
  const request = await http("POST", "/api/friends/requests", tokens[0], {
    userId: 3,
  });
  assert.equal(request.status, 201);
  const id = request.body.requestId;
  assert.equal(
    (await http("POST", `/api/friends/requests/${id}/accept`, tokens[0]))
      .status,
    403,
  );
  assert.equal(
    (await http("POST", `/api/friends/requests/${id}/accept`, tokens[1]))
      .status,
    200,
  );
  const list = await http("GET", "/api/friends", tokens[0]);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.friends, [
    { userId: 3, nickname: "HttpBob", avatarUrl: null, online: true },
  ]);
  assert.equal((await http("DELETE", "/api/friends/3", tokens[0])).status, 204);
  assert.equal(
    (await http("GET", "/api/friends", tokens[1])).body.friends.length,
    0,
  );
  console.log(
    "PASS: real loopback HTTP / two accounts / auth / request / accept / online injection / delete (no HTTP mocks).",
  );
  console.log((await pool.query("SELECT version()")).rows[0].version);
} finally {
  await app?.close();
  await pool.end();
  await rm(temp, { recursive: true, force: true });
}
