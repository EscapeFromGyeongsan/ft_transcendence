import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./app";
import { openDatabase, type Database } from "./db/database";
import { RoomStore, type RoomSnapshot } from "./rooms";
import { saveResult, history } from "./history";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>, directory: string;
let failSave = false;
const store = new RoomStore();
const origin = "http://127.0.0.1:5173";
const sockets: WebSocket[] = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "cafe-matches-"));
  db = await openDatabase({ directory });
  const storage: Database = {
    query: (sql, values) => {
      if (failSave && sql.includes("INSERT INTO game_matches"))
        return Promise.reject(new Error("simulated database outage"));
      return db.query(sql, values);
    },
    close: () => db.close(),
  };
  app = await buildApp(store, {
    database: storage,
    origin,
    secureCookies: false,
  });
}, 30000);
afterAll(async () => {
  sockets.forEach((socket) => socket.terminate());
  await app?.close();
  await db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function register(name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { origin },
    payload: {
      email: `${name}@example.com`,
      displayName: name,
      password: "test password long enough",
    },
  });
  expect(response.statusCode).toBe(201);
  return {
    id: response.json().user.id as string,
    cookie: String(response.headers["set-cookie"]).split(";")[0],
  };
}
function client(url: string, cookie?: string) {
  const socket = new WebSocket(url, {
    headers: { origin, ...(cookie ? { cookie } : {}) },
  });
  sockets.push(socket);
  const messages: {
    type: string;
    requestId?: string;
    error?: string;
    room?: RoomSnapshot;
    playerId?: string;
  }[] = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  let sequence = 0;
  return {
    async take(type: string, requestId?: string) {
      const predicate = (m: (typeof messages)[number]) =>
        m.type === type && (!requestId || m.requestId === requestId);
      await expect.poll(() => messages.some(predicate)).toBe(true);
      return messages.splice(messages.findIndex(predicate), 1)[0];
    },
    async command(type: string, data: object = {}, error?: string) {
      const requestId = String(++sequence);
      socket.send(JSON.stringify({ ...data, type, requestId }));
      const response = await this.take(error ? "error" : "ack", requestId);
      if (error) expect(response.error).toBe(error);
      return response.room!;
    },
  };
}
it("binds seats to accounts, persists results once, recovers seats and rejects revoked sessions", async () => {
  const alice = await register("Alice"),
    bob = await register("Bob"),
    observer = await register("Observer");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/rooms",
        payload: { title: "No login" },
      })
    ).statusCode,
  ).toBe(401);
  const created = await app.inject({
    method: "POST",
    url: "/api/rooms",
    headers: { cookie: alice.cookie, origin },
    payload: { title: "Account match", hostName: "Spoofed" },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().room.id;
  expect(created.json().room.players[0].name).toBe("Alice");
  expect(created.json().token).toBeUndefined();
  const joinRoom = (cookie: string) =>
    app.inject({
      method: "POST",
      url: `/api/rooms/${id}/join`,
      headers: { cookie, origin },
      payload: { name: "Spoofed" },
    });
  expect((await joinRoom(alice.cookie)).json().room.players).toHaveLength(1);
  const joined = await joinRoom(bob.cookie);
  expect(joined.json().room.players[1].name).toBe("Bob");
  expect((await joinRoom(alice.cookie)).json().room.players).toHaveLength(2);
  expect((await joinRoom(observer.cookie)).statusCode).toBe(409);
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const url = address.replace("http:", "ws:") + `/api/rooms/${id}/ws`;
  const a = client(url, alice.cookie),
    b = client(url, bob.cookie),
    spectator = client(url);
  expect((await a.take("snapshot")).playerId).toBe(alice.id);
  await b.take("snapshot");
  await spectator.take("snapshot");
  await spectator.command("ready", { token: alice.id }, "LOGIN_REQUIRED");
  const ready = await a.command("ready", { token: bob.id, playerId: bob.id });
  expect(ready.players.map((player) => player.ready)).toEqual([true, false]);
  await b.command("ready");
  let room = await a.command("start");
  await a.command("close", {}, "CANNOT_CLOSE_PLAYING");
  const otherTab = client(url, alice.cookie);
  const restored = await otherTab.take("snapshot");
  expect(restored.playerId).toBe(alice.id);
  expect(restored.room!.players).toHaveLength(2);
  const action = {
    action: { type: "RESIGN" },
    expectedVersion: 0,
    matchId: room.matchId,
  };
  failSave = true;
  await a.command("action", action, "RESULT_SAVE_FAILED");
  expect(store.get(id).status).toBe("playing");
  expect(store.get(id).game.stateVersion).toBe(0);
  failSave = false;
  const results = await Promise.all([
    a.command("action", action),
    a.command("action", action, "NOT_PLAYING"),
  ]);
  room = results[0];
  expect(room.status).toBe("finished");
  await saveResult(db, room);
  expect(
    (
      await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM game_matches",
      )
    ).rows[0].count,
  ).toBe(1);
  const getHistory = (cookie: string) =>
    app.inject({ url: "/api/me/matches", headers: { cookie } });
  expect((await app.inject("/api/me/matches")).statusCode).toBe(401);
  const ah = (await getHistory(alice.cookie)).json(),
    bh = (await getHistory(bob.cookie)).json();
  expect(ah.summary).toEqual({
    total: 1,
    wins: 0,
    losses: 1,
    draws: 0,
    winRate: 0,
  });
  expect(ah.matches[0]).toMatchObject({
    opponent: "Bob",
    outcome: "loss",
    reason: "resignation",
  });
  expect(bh.summary.wins).toBe(1);
  expect((await getHistory(observer.cookie)).json().matches).toEqual([]);
  await a.command("rematch");
  await a.command("ready");
  await b.command("ready");
  const newMatch = await a.command("start");
  expect(newMatch.matchId).not.toBe(room.matchId);
  await a.command("action", action, "STALE_MATCH");
  for (let x = 0; x < 5; x++) {
    await a.command("action", {
      action: { type: "PLACE_STONE", x, y: 0 },
      expectedVersion: 2 * x,
      matchId: newMatch.matchId,
    });
    if (x < 4)
      await b.command("action", {
        action: { type: "PLACE_STONE", x, y: 1 },
        expectedVersion: 2 * x + 1,
        matchId: newMatch.matchId,
      });
  }
  expect((await history(db, alice.id)).matches[0]).toMatchObject({
    outcome: "win",
    reason: "five",
    moveCount: 9,
  });
  // Persist a draw fixture to exercise outcome mapping independently of engine rule tests.
  await saveResult(db, {
    ...newMatch,
    matchId: randomUUID(),
    finishedAt: new Date().toISOString(),
    result: { kind: "draw", winnerSeats: [], reason: "draw", moveCount: 0 },
  });
  const drawHistory = await history(db, bob.id);
  expect(drawHistory.summary).toEqual({
    total: 3,
    wins: 1,
    losses: 1,
    draws: 1,
    winRate: 33.3,
  });
  await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { cookie: alice.cookie, origin },
    payload: {},
  });
  await otherTab.command("ready", {}, "LOGIN_REQUIRED");
  sockets.forEach((socket) => socket.terminate());
  await app.close();
  await db.close();
  db = await openDatabase({ directory });
  app = await buildApp(undefined, {
    database: db,
    origin,
    secureCookies: false,
  });
  expect(
    (
      await app.inject({
        url: "/api/me/matches",
        headers: { cookie: bob.cookie },
      })
    ).json().summary.total,
  ).toBe(3);
}, 30000);
