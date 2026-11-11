import assert from "node:assert/strict";
import https from "node:https";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import WebSocket from "./harness/node_modules/ws/index.js";

const root = new URL("./", import.meta.url);
const ports = JSON.parse(
  await readFile(new URL("output/ports.json", root), "utf8"),
);
const ca = await readFile(new URL("private/certs/server.crt", root));
const result = {
  startedAt: new Date().toISOString(),
  source: "PR40 + PR50 + real PR45 engine",
  checks: [],
  events: [],
};
const peers = [];
const tokens = [];
const start = performance.now();
const elapsed = () => Math.round(performance.now() - start);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function pass(name, details = {}) {
  result.checks.push({
    name,
    status: "pass",
    elapsedMs: elapsed(),
    ...details,
  });
  console.log(
    JSON.stringify({
      check: name,
      status: "pass",
      elapsedMs: elapsed(),
      ...details,
    }),
  );
}
function request(path, { method = "GET", body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: ports.https,
        path,
        method,
        ca,
        rejectUnauthorized: true,
        headers: {
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(data),
              }
            : {}),
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode,
            body: parsed,
            tlsAuthorized: res.socket?.authorized,
          });
        });
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error("HTTPS timeout")));
    req.on("error", reject);
    req.end(data);
  });
}
class Peer {
  constructor(label, autoPong = true) {
    this.label = label;
    this.messages = [];
    this.waiters = [];
    this.pings = [];
    this.ws = new WebSocket("wss://127.0.0.1:" + ports.https + "/api/ws", {
      ca,
      rejectUnauthorized: true,
      autoPong,
      handshakeTimeout: 10000,
    });
    this.openedAt = performance.now();
    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.ws.on("error", () => {});
    this.ws.on("upgrade", (res) => {
      this.upgradeStatus = res.statusCode;
      this.tlsAuthorized = res.socket.authorized;
    });
    this.ws.on("ping", () => this.pings.push(elapsed()));
    this.closed = new Promise((resolve) =>
      this.ws.once("close", (code, reason) => {
        this.closeResult = {
          code,
          reason: reason.toString(),
          elapsedMs: elapsed(),
        };
        resolve(this.closeResult);
      }),
    );
    this.ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      const waiter = this.waiters.find(
        (w) => w.type === m.type && w.predicate(m),
      );
      if (waiter) {
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(m);
      } else this.messages.push(m);
      result.events.push({
        peer: label,
        type: m.type,
        elapsedMs: elapsed(),
        stateVersion: m.payload?.stateVersion,
        remainingMs: m.payload?.remainingMs,
      });
    });
    peers.push(this);
  }
  send(type, payload = {}, requestId = randomUUID()) {
    this.ws.send(JSON.stringify({ type, requestId, payload }));
    return requestId;
  }
  wait(type, predicate = () => true, timeout = 12000) {
    const i = this.messages.findIndex((m) => m.type === type && predicate(m));
    if (i >= 0) return Promise.resolve(this.messages.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(this.label + " timed out waiting for " + type));
      }, timeout);
      this.waiters.push(waiter);
    });
  }
  async auth(token) {
    await this.opened;
    assert.equal(this.upgradeStatus, 101);
    assert.equal(this.tlsAuthorized, true);
    const id = this.send("auth", { accessToken: token });
    return this.wait("auth.ok", (m) => m.requestId === id);
  }
  async close(code = 1000) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close(code);
    return this.closed;
  }
}
async function closedWithin(peer, timeout = 12000) {
  let timer;
  try {
    return await Promise.race([
      peer.closed,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(peer.label + " close timed out")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
try {
  const health = await request("/api/health/db");
  assert.equal(health.status, 200);
  pass("HTTPS DB health with explicit certificate trust");
  const password = randomUUID() + "aA1";
  const accounts = [];
  for (let i = 0; i < 2; i++) {
    const email = "wss-" + randomUUID() + "@example.com";
    const register = await request("/api/auth/register", {
      method: "POST",
      body: {
        email,
        password,
        nickname: "wss_" + randomUUID().replaceAll("-", "").slice(0, 18),
      },
    });
    assert.equal(register.status, 201);
    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(login.status, 200);
    assert.equal(typeof login.body.accessToken, "string");
    tokens.push(login.body.accessToken);
    accounts.push({ id: register.body.id, token: login.body.accessToken });
  }
  pass("HTTPS register and login for two real accounts");
  const idle = new Peer("healthy-idle");
  await idle.auth(accounts[1].token);
  const idleStart = performance.now();
  const negatives = [
    ["unauthenticated timeout", undefined, 4401],
    [
      "invalid token",
      { type: "auth", payload: { accessToken: "invalid-wss-review-token" } },
      4401,
    ],
    ["message before auth", { type: "ping", payload: {} }, 4401],
    ["malformed JSON", "invalid-json", 4400],
  ];
  await Promise.all(
    negatives.map(async ([name, message, expectedCode]) => {
      const p = new Peer(name);
      await p.opened;
      if (message !== undefined)
        p.ws.send(
          typeof message === "string" ? message : JSON.stringify(message),
        );
      const ended = await closedWithin(p, 8000);
      assert.equal(ended.code, expectedCode);
      pass("WSS " + name, { closeCode: ended.code });
    }),
  );
  const a = new Peer("player-a-silent", false),
    b = new Peer("player-b");
  const [aa, ab] = await Promise.all([
    a.auth(accounts[0].token),
    b.auth(accounts[1].token),
  ]);
  assert.equal(aa.payload.userId, accounts[0].id);
  assert.equal(ab.payload.userId, accounts[1].id);
  const pingRequest = b.send("ping");
  await b.wait("pong", (m) => m.requestId === pingRequest);
  pass("WSS 101, first-message auth and requestId echo");
  a.send("queue.join", { gameType: "gomoku" });
  b.send("queue.join", { gameType: "gomoku" });
  const [ma, mb] = await Promise.all([
    a.wait("queue.matched"),
    b.wait("queue.matched"),
  ]);
  assert.equal(ma.payload.matchId, mb.payload.matchId);
  const matchId = ma.payload.matchId;
  result.matchId = matchId;
  result.players = accounts.map((x) => x.id);
  a.send("match.subscribe", { matchId });
  b.send("match.subscribe", { matchId });
  const [sa, sb] = await Promise.all([
    a.wait("match.snapshot"),
    b.wait("match.snapshot"),
  ]);
  assert.deepEqual(sa.payload, sb.payload);
  assert.equal(sa.payload.rulesVersion, "gomoku-freestyle-v1");
  assert.equal(sa.payload.board.length, 15);
  assert.equal(sa.payload.board.flat().filter(Boolean).length, 0);
  const black = sa.payload.players.black === accounts[0].id ? a : b;
  const other = black === a ? b : a;
  const action = {
    matchId,
    gameType: "gomoku",
    commandId: randomUUID(),
    expectedVersion: 0,
    action: { type: "place", row: 7, col: 8 },
  };
  black.send("game.command", action);
  const ack = await black.wait("game.ack");
  assert.equal(ack.payload.stateVersion, 1);
  const updates = await Promise.all([
    a.wait("game.updated"),
    b.wait("game.updated"),
  ]);
  assert.deepEqual(updates[0].payload, updates[1].payload);
  assert.equal(updates[0].payload.board[7][8], "black");
  pass(
    "Real gomoku matchmaking, subscription, persisted move and matching snapshots",
    { matchId, stateVersion: 1 },
  );
  black.send("game.command", action);
  assert.equal((await black.wait("game.ack")).payload.duplicate, true);
  other.send("game.command", {
    ...action,
    commandId: randomUUID(),
    action: { type: "place", row: 8, col: 8 },
  });
  assert.equal(
    (await other.wait("game.error")).payload.code,
    "VERSION_CONFLICT",
  );
  assert.equal((await other.wait("match.snapshot")).payload.stateVersion, 1);
  pass("Duplicate command replay and stale-version snapshot recovery");
  const lost = await closedWithin(a, 35000);
  assert.equal(lost.code, 1006);
  const disconnected = await b.wait(
    "player.disconnected",
    (m) => m.payload.userId === accounts[0].id,
  );
  assert.ok(
    disconnected.payload.remainingMs > 20000 &&
      disconnected.payload.remainingMs < 50000,
  );
  pass("Default heartbeat drops no-pong peer through Nginx", {
    closeCode: lost.code,
    remainingMs: disconnected.payload.remainingMs,
    pingCount: a.pings.length,
  });
  const resumed = new Peer("player-a-resumed");
  const authResume = await resumed.auth(accounts[0].token);
  assert.equal(authResume.payload.activeMatchId, matchId);
  resumed.send("match.subscribe", { matchId });
  const recovered = await resumed.wait("match.snapshot");
  assert.equal(recovered.payload.board[7][8], "black");
  assert.equal(recovered.payload.stateVersion, 1);
  const reconnected = await b.wait(
    "player.reconnected",
    (m) => m.payload.userId === accounts[0].id,
  );
  assert.ok(
    reconnected.payload.remainingMs <= disconnected.payload.remainingMs,
  );
  pass(
    "Reauthentication and resubscription restore snapshot without resetting absence budget",
    { remainingMs: reconnected.payload.remainingMs },
  );
  await resumed.close();
  const left = await b.wait(
    "player.disconnected",
    (m) => m.payload.userId === accounts[0].id,
  );
  const finished = await b.wait(
    "game.updated",
    (m) => m.payload.status === "finished",
    65000,
  );
  assert.equal(finished.payload.result.reason, "disconnect_timeout");
  assert.equal(finished.payload.result.outcome, "win");
  assert.equal(finished.payload.result.winnerId, accounts[1].id);
  assert.equal(finished.payload.stateVersion, 2);
  assert.equal(finished.payload.board[7][8], "black");
  result.finalSnapshot = finished.payload;
  pass(
    "Cumulative 60-second absence commits winner and broadcasts preserved board",
    { remainingMsAtDisconnect: left.payload.remainingMs, stateVersion: 2 },
  );
  const idleRemaining = 85000 - (performance.now() - idleStart);
  if (idleRemaining > 0) {
    console.log(
      JSON.stringify({
        status: "waiting",
        check: "idle WSS beyond 75-second Nginx timeout",
        remainingMs: Math.ceil(idleRemaining),
      }),
    );
    await sleep(idleRemaining);
  }
  assert.equal(idle.ws.readyState, WebSocket.OPEN);
  assert.ok(idle.pings.length >= 8);
  const idlePing = idle.send("ping");
  await idle.wait("pong", (m) => m.requestId === idlePing);
  pass("Idle WSS survives more than 75 seconds with default server heartbeat", {
    observedMs: Math.round(performance.now() - idleStart),
    pingCount: idle.pings.length,
  });
  const logout = await request("/api/auth/logout", {
    method: "POST",
    token: accounts[1].token,
  });
  assert.equal(logout.status, 204);
  for (const p of [idle, b]) assert.equal((await closedWithin(p)).code, 4401);
  const revoked = new Peer("revoked-session");
  await revoked.opened;
  revoked.send("auth", { accessToken: accounts[1].token });
  assert.equal((await closedWithin(revoked)).code, 4401);
  pass(
    "HTTPS logout closes authenticated WSS and blocks revoked-token reconnect",
  );
  result.status = "pass";
} catch (error) {
  result.status = "fail";
  result.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  console.error(JSON.stringify({ status: "fail", error: result.error }));
  process.exitCode = 1;
} finally {
  for (const peer of peers) {
    for (const w of peer.waiters) clearTimeout(w.timer);
    if (peer.ws.readyState !== WebSocket.CLOSED) peer.ws.terminate();
  }
  result.finishedAt = new Date().toISOString();
  result.durationMs = elapsed();
  const serialized = JSON.stringify(result, null, 2);
  for (const token of tokens)
    assert.ok(
      !serialized.includes(token),
      "Result must not contain access tokens",
    );
  await writeFile(new URL("output/wss-results.json", root), serialized + "\n");
  console.log(
    JSON.stringify({
      status: result.status,
      checks: result.checks.length,
      durationMs: result.durationMs,
    }),
  );
}
