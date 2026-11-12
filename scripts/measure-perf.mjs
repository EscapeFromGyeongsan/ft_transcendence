// NFR-PERF-01 load measurement against a running HTTPS/WSS stack.
// Usage: npm run test:perf -- [--users 20] [--games 10]
//   [--duration 300] [--move-interval 1000] [--rest-interval 1000]
//   [--no-realtime] [--out path.json]
// Env: PERF_BASE_URL (default https://localhost:8443), PERF_PASSWORD (8+ chars),
// NODE_EXTRA_CA_CERTS=<server.crt> for a self-signed certificate,
// PERF_SERVER_COMMIT to record the commit the measured server runs.
// Defaults follow the SRS proposal (20 users, 10 gomoku games, 5 minutes);
// DEC-10 has not approved them, so this script reports numbers, not a verdict.
// Creates or reuses perf-u01.. accounts and plays real gomoku games with them,
// so run it against a dedicated environment, not one with real players.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    users: { type: "string", default: "20" },
    games: { type: "string", default: "10" },
    duration: { type: "string", default: "300" },
    "move-interval": { type: "string", default: "1000" },
    "rest-interval": { type: "string", default: "1000" },
    "no-realtime": { type: "boolean", default: false },
    out: { type: "string" },
  },
});
const userCount = Number(args.users);
const gameCount = Math.min(Number(args.games), Math.floor(userCount / 2));
const durationMs = Number(args.duration) * 1000;
const moveIntervalMs = Number(args["move-interval"]);
const restIntervalMs = Number(args["rest-interval"]);
const realtime = !args["no-realtime"];
const baseUrl = process.env.PERF_BASE_URL ?? "https://localhost:8443";
const password = process.env.PERF_PASSWORD;
if (!password || password.length < 8)
  throw new Error("Set PERF_PASSWORD (8+ characters).");
// A reply that never comes counts as a failure after this long.
const replyTimeoutMs = 10_000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const samples = new Map();
const failures = new Map();
function record(metric, ms) {
  if (!samples.has(metric)) samples.set(metric, []);
  samples.get(metric).push(ms);
}
function fail(metric, reason) {
  const key = `${metric}: ${reason}`;
  failures.set(key, (failures.get(key) ?? 0) + 1);
}

// Auth routes allow 10 requests per minute per IP, so setup waits out 429s.
async function authPost(path, body) {
  for (;;) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("retry-after") ?? 60);
    console.log(`auth rate limited, waiting ${wait}s`);
    await sleep(wait * 1000);
  }
}

async function prepareUser(index) {
  const nickname = `perf-u${String(index).padStart(2, "0")}`;
  const email = `${nickname}@perf.example.com`;
  const created = await authPost("/api/auth/register", {
    email,
    password,
    nickname,
  });
  if (created.status !== 201 && created.status !== 409)
    throw new Error(`register ${email}: HTTP ${created.status}`);
  const login = await authPost("/api/auth/login", { email, password });
  const tokens = await login.json();
  if (login.status !== 200 || !tokens.accessToken)
    throw new Error(`login ${email}: HTTP ${login.status}`);
  const me = await fetch(`${baseUrl}/api/users/me`, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });
  return { id: (await me.json()).id, token: tokens.accessToken };
}

// Time from just before the request to the parsed success body.
async function timedGet(metric, path, token) {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(replyTimeoutMs),
    });
    await response.json();
    if (response.ok) record(metric, performance.now() - started);
    else fail(metric, `HTTP ${response.status}`);
  } catch (error) {
    fail(metric, error.name);
  }
}

async function restLoop(user, others, until) {
  const other = others[Math.floor(Math.random() * others.length)];
  const requests = [
    ["GET /api/users/me", "/api/users/me"],
    ["GET /api/users/:userId", `/api/users/${other.id}`],
    [
      "GET /api/users/:userId/stats",
      `/api/users/${other.id}/stats?gameType=gomoku`,
    ],
    ["GET /api/leaderboard", "/api/leaderboard?gameType=gomoku"],
  ];
  for (let i = 0; performance.now() < until; i++) {
    const [metric, path] = requests[i % requests.length];
    await timedGet(metric, path, user.token);
    await sleep(restIntervalMs);
  }
}

// One WebSocket client. Waiters resolve on the first message that matches.
function connect(user) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/ws`);
    const waiters = new Set();
    const client = {
      socket,
      handlers: new Set(),
      send(type, payload) {
        socket.send(JSON.stringify({ type, requestId: randomUUID(), payload }));
      },
      wait(match) {
        return new Promise((done, timeout) => {
          const waiter = { match, done };
          waiters.add(waiter);
          setTimeout(() => {
            if (waiters.delete(waiter)) timeout(new Error("timeout"));
          }, replyTimeoutMs);
        });
      },
    };
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "error") fail("websocket", message.payload.code);
      for (const waiter of waiters) {
        if (waiter.match(message)) {
          waiters.delete(waiter);
          waiter.done(message);
        }
      }
      for (const handler of client.handlers) handler(message);
    });
    socket.addEventListener("close", (event) => {
      if (!client.closing) fail("websocket", `closed ${event.code}`);
    });
    socket.addEventListener("error", () => reject(new Error("ws error")));
    socket.addEventListener("open", async () => {
      client.send("auth", { accessToken: user.token });
      try {
        const ok = await client.wait((m) => m.type === "auth.ok");
        client.activeMatchId = ok.payload.activeMatchId ?? null;
        resolve(client);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Opponent receipt of game.updated, timed from the mover's send in the same
// process. This is end-to-end latency, not server-commit-to-client delivery.
const inFlight = new Map();
function watchOpponentUpdates(user, client) {
  client.handlers.add((m) => {
    if (m.type !== "game.updated") return;
    const key = `${m.payload.matchId}:${m.payload.stateVersion}`;
    const move = inFlight.get(key);
    if (move && move.by !== user.id) {
      record(
        "game.command -> opponent game.updated",
        performance.now() - move.sent,
      );
      inFlight.delete(key);
    }
  });
}

// Subscribes and keeps `match.state` current from snapshots and updates.
async function watchMatch(client, matchId) {
  client.send("match.subscribe", { matchId });
  const first = await client.wait(
    (m) => m.type === "match.snapshot" && m.payload.matchId === matchId,
  );
  const match = { matchId, state: first.payload };
  match.finished = new Promise((done) => {
    const handler = (m) => {
      if (
        (m.type === "game.updated" || m.type === "match.snapshot") &&
        m.payload.matchId === matchId &&
        m.payload.stateVersion >= match.state.stateVersion
      ) {
        match.state = m.payload;
        if (match.state.status === "finished") {
          client.handlers.delete(handler);
          done();
        }
      }
    };
    client.handlers.add(handler);
    if (match.state.status === "finished") done();
  });
  client.match = match;
  return match;
}

// Ends a match this script left open, so no game is left to the 60 s
// disconnect timeout and the player can queue again. Not measured.
async function resign(client, match) {
  const deadline = performance.now() + 90_000;
  while (match.state.status === "paused" && performance.now() < deadline)
    await Promise.race([match.finished, sleep(200)]);
  if (match.state.status === "playing") {
    client.send("game.command", {
      matchId: match.matchId,
      gameType: "gomoku",
      commandId: randomUUID(),
      expectedVersion: match.state.stateVersion,
      action: { type: "resign" },
    });
  }
  await Promise.race([match.finished, sleep(deadline - performance.now())]);
}

// Plays random empty cells; when a game ends, queues again until time is up.
async function playLoop(user, client, until) {
  while (performance.now() < until) {
    const joined = performance.now();
    client.send("queue.join", { gameType: "gomoku" });
    let matched;
    try {
      matched = await client.wait((m) => m.type === "queue.matched");
    } catch {
      // Someone still queued when the run ends has no partner left.
      if (performance.now() < until)
        fail("queue.join -> queue.matched", "timeout");
      continue;
    }
    record("queue.join -> queue.matched", performance.now() - joined);
    const { matchId } = matched.payload;
    let match;
    try {
      match = await watchMatch(client, matchId);
    } catch {
      fail("match.subscribe", "timeout");
      continue;
    }
    while (match.state.status !== "finished" && performance.now() < until) {
      const state = match.state;
      if (state.currentPlayerId !== user.id || state.status !== "playing") {
        await Promise.race([match.finished, sleep(50)]);
        continue;
      }
      await sleep(moveIntervalMs);
      const empty = [];
      state.board.forEach((row, r) =>
        row.forEach((cell, c) => cell === null && empty.push([r, c])),
      );
      const [row, col] = empty[Math.floor(Math.random() * empty.length)];
      const commandId = randomUUID();
      const version = state.stateVersion;
      const sent = performance.now();
      inFlight.set(`${matchId}:${version + 1}`, { sent, by: user.id });
      client.send("game.command", {
        matchId,
        gameType: "gomoku",
        commandId,
        expectedVersion: version,
        action: { type: "place", row, col },
      });
      try {
        const reply = await client.wait(
          (m) =>
            (m.type === "game.ack" || m.type === "game.error") &&
            m.payload.commandId === commandId,
        );
        if (reply.type === "game.ack")
          record("game.command -> game.ack", performance.now() - sent);
        else fail("game.command -> game.ack", reply.payload.code);
      } catch {
        fail("game.command -> game.ack", "timeout");
      }
      // Wait for our own update so the next turn check sees the new state.
      while (
        match.state.stateVersion <= version &&
        match.state.status !== "finished"
      ) {
        await Promise.race([match.finished, sleep(20)]);
      }
    }
    // Leaving an unfinished match would pause it for the opponent.
    if (match.state.status === "finished")
      client.send("match.unsubscribe", { matchId });
  }
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const round = (ms) => Math.round(ms * 10) / 10;
  return {
    count: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1)),
  };
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"])
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const users = [];
for (let i = 1; i <= userCount; i++) users.push(await prepareUser(i));
console.log(`prepared ${users.length} users`);

const players = realtime ? users.slice(0, gameCount * 2) : [];
const clients = await Promise.all(players.map((user) => connect(user)));
clients.forEach((client, i) => watchOpponentUpdates(players[i], client));
// Both players of a leftover match subscribe so it can resume, then resign.
await Promise.all(
  clients.map(async (client) => {
    if (client.activeMatchId === null) return;
    const match = await watchMatch(client, client.activeMatchId);
    await resign(client, match);
    client.send("match.unsubscribe", { matchId: match.matchId });
  }),
);

const startedAt = new Date();
const until = performance.now() + durationMs;
await Promise.all([
  ...users.map((user) =>
    restLoop(
      user,
      users.filter((u) => u !== user),
      until,
    ),
  ),
  ...clients.map((client, i) => playLoop(players[i], client, until)),
]);
// One player of each unfinished match resigns while both are still connected.
await Promise.all(
  clients.map((client, i) => {
    const match = client.match;
    if (!match || match.state.status === "finished") return;
    const { black, white } = match.state.players;
    if (players[i].id === Math.min(black, white)) return resign(client, match);
    return Promise.race([match.finished, sleep(90_000)]);
  }),
);
for (const client of clients) {
  client.closing = true;
  client.socket.close();
}

const result = {
  baseUrl,
  scriptCommit: gitCommit(),
  // The measured server may run another checkout; pass its commit explicitly.
  serverCommit: process.env.PERF_SERVER_COMMIT ?? null,
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  options: {
    users: userCount,
    games: realtime ? gameCount : 0,
    durationSeconds: durationMs / 1000,
    moveIntervalMs,
    restIntervalMs,
  },
  machine: {
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: `${cpus()[0]?.model} x${cpus().length}`,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    node: process.version,
  },
  metrics: Object.fromEntries(
    [...samples].map(([metric, values]) => [metric, summarize(values)]),
  ),
  failures: Object.fromEntries(failures),
};
const json = JSON.stringify(result, null, 2);
if (args.out) writeFileSync(args.out, `${json}\n`);
console.log(json);
