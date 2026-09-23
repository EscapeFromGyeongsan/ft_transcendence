import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openDatabase, type Database } from "./db/database";
import { buildApp } from "./app";

const origin = "http://127.0.0.1:5173";
const password = "correct horse battery staple";
let directory: string;
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
const post = (
  path: string,
  payload: Record<string, unknown>,
  session?: string,
  source = origin,
) =>
  app.inject({
    method: "POST",
    url: `/api/auth/${path}`,
    payload,
    headers: { origin: source, ...(session ? { cookie: session } : {}) },
  });
const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  String(response.headers["set-cookie"]).split(";")[0];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "cafe-auth-"));
  db = await openDatabase({ directory });
  app = await buildApp(undefined, {
    database: db,
    origin,
    secureCookies: false,
  });
}, 30000);
afterAll(async () => {
  await app?.close();
  await db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("persisted accounts and sessions", () => {
  it("registers, hashes secrets, persists across restarts and revokes logout sessions", async () => {
    const created = await post("register", {
      email: "Alice@EXAMPLE.com",
      password,
      displayName: "Alice",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user.email).toBe("alice@example.com");
    expect(created.body).not.toContain("password");
    expect(created.headers["set-cookie"]).toContain("HttpOnly");
    expect(created.headers["set-cookie"]).toContain("SameSite=Strict");
    const cookie = sessionCookie(created);
    const rows = (
      await db.query<{ password_hash: string }>(
        "SELECT password_hash FROM users",
      )
    ).rows;
    expect(rows[0].password_hash).toMatch(/^scrypt:/);
    expect(rows[0].password_hash).not.toContain(password);
    const sessions = (
      await db.query<{ token_hash: string }>("SELECT token_hash FROM sessions")
    ).rows;
    expect(sessions[0].token_hash).not.toBe(cookie.split("=")[1]);
    expect(sessions[0].token_hash).toHaveLength(64);
    await app.close();
    await db.close();
    db = await openDatabase({ directory });
    app = await buildApp(undefined, {
      database: db,
      origin,
      secureCookies: false,
    });
    expect(
      (await app.inject({ url: "/api/auth/me", headers: { cookie } })).json()
        .user.displayName,
    ).toBe("Alice");
    expect(
      (
        await post("login", {
          email: "alice@example.com",
          password: "wrong password value",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await post("login", { email: "nobody@example.com", password }))
        .statusCode,
    ).toBe(401);
    const login = await post(
      "login",
      { email: "ALICE@example.com", password },
      cookie,
    );
    expect(login.statusCode).toBe(200);
    const fresh = sessionCookie(login);
    expect(fresh).not.toBe(cookie);
    expect(
      (await app.inject({ url: "/api/auth/me", headers: { cookie } })).json()
        .user,
    ).toBeNull();
    expect((await post("logout", {}, fresh)).statusCode).toBe(200);
    expect(
      (
        await app.inject({ url: "/api/auth/me", headers: { cookie: fresh } })
      ).json().user,
    ).toBeNull();
    const loggedIn = await post("login", {
      email: "alice@example.com",
      password,
    });
    const expired = sessionCookie(loggedIn);
    await db.query(
      "UPDATE sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE token_hash = $1",
      [createHash("sha256").update(expired.split("=")[1]).digest("hex")],
    );
    expect(
      (
        await app.inject({ url: "/api/auth/me", headers: { cookie: expired } })
      ).json().user,
    ).toBeNull();
  }, 30000);
  it("rejects duplicate accounts, bad inputs and cross-origin mutation", async () => {
    expect(
      (
        await post("register", {
          email: "ALICE@example.com",
          password,
          displayName: "Other",
        })
      ).statusCode,
    ).toBe(409);
    for (const values of [
      { email: "invalid", password, displayName: "A" },
      { email: "new@example.com", password: "short", displayName: "A" },
      { email: "new@example.com", password, displayName: "   " },
    ])
      expect((await post("register", values)).statusCode).toBe(400);
    expect(
      (await post("logout", {}, undefined, "https://attacker.example"))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: "/api/auth/logout" }))
        .statusCode,
    ).toBe(415);
    expect((await app.inject("/api/auth/me")).json().user).toBeNull();
  });
  it("limits login attempts", async () => {
    let limited = false;
    for (let i = 0; i < 11; i++) {
      const response = await post("login", {
        email: "missing@example.com",
        password,
      });
      if (response.statusCode === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  }, 30000);
});
