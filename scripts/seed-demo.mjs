// Demo data for evaluation: real matches played through the running app.
// Usage: npm run demo:seed
// Env: DEMO_BASE_URL (default https://localhost:8443), DEMO_PASSWORD (8+ chars),
// NODE_EXTRA_CA_CERTS=<server.crt> for a self-signed certificate.
// Creates or reuses demo-alice, demo-bob, demo-carol and demo-dave, then plays
// gomoku and othello matches over /api/ws, so statistics, match history,
// achievements and the leaderboard come from stored results. Each run adds
// the same matches again.
import { randomUUID } from "node:crypto";

const baseUrl = process.env.DEMO_BASE_URL ?? "https://localhost:8443";
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 8)
  throw new Error("Set DEMO_PASSWORD (8+ characters).");
const replyTimeoutMs = 10_000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

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

async function prepareUser(name) {
  const nickname = `demo-${name}`;
  const email = `${nickname}@demo.example.com`;
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
  return {
    name,
    nickname,
    id: (await me.json()).id,
    token: tokens.accessToken,
  };
}

function connect(user) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/ws`);
    const waiters = new Set();
    const client = {
      user,
      socket,
      state: null,
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
      if (message.type === "error" || message.type === "game.error")
        console.log(
          `${user.nickname}: ${message.type} ${message.payload.code}`,
        );
      const { payload } = message;
      if (
        (message.type === "game.updated" ||
          message.type === "match.snapshot") &&
        payload.matchId === client.state?.matchId &&
        payload.stateVersion >= client.state.stateVersion
      )
        client.state = payload;
      for (const waiter of waiters) {
        if (waiter.match(message)) {
          waiters.delete(waiter);
          waiter.done(message);
        }
      }
    });
    socket.addEventListener("error", () => reject(new Error("ws error")));
    socket.addEventListener("open", async () => {
      client.send("auth", { accessToken: user.token });
      try {
        await client.wait((m) => m.type === "auth.ok");
        resolve(client);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// The winner builds five in row 7; the loser's stones never line up.
const GOMOKU_WIN = [3, 4, 5, 6, 7].map((col) => [7, col]);
const GOMOKU_LOSE = [0, 2, 4, 6, 8, 10, 12, 14].map((col) => [0, col]);
const DIRECTIONS = [-1, 0, 1]
  .flatMap((dr) => [-1, 0, 1].map((dc) => [dr, dc]))
  .filter(([dr, dc]) => dr || dc);

function othelloMoves(board, color) {
  const size = board.length;
  const inside = (r, c) => r >= 0 && r < size && c >= 0 && c < size;
  const moves = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== null) continue;
      const flips = DIRECTIONS.some(([dr, dc]) => {
        let [y, x, seen] = [r + dr, c + dc, 0];
        while (inside(y, x) && board[y][x] && board[y][x] !== color) {
          [y, x, seen] = [y + dr, x + dc, seen + 1];
        }
        return seen > 0 && inside(y, x) && board[y][x] === color;
      });
      if (flips) moves.push([r, c]);
    }
  }
  return moves;
}

function nextAction(client, gameType, plan, turn) {
  const { state, user } = client;
  if (gameType === "othello") {
    const color = state.players.black === user.id ? "black" : "white";
    const moves = othelloMoves(state.board, color);
    const [row, col] = moves[Math.floor(Math.random() * moves.length)];
    return { type: "place", row, col };
  }
  const winner = plan.winner === user.name;
  if (!winner && plan.resign) return { type: "resign" };
  const [row, col] = (winner ? GOMOKU_WIN : GOMOKU_LOSE)[turn];
  return { type: "place", row, col };
}

// Plays one match between two clients and returns the finished state.
async function playMatch(gameType, a, b, plan = {}) {
  const matched = [a, b].map((c) => c.wait((m) => m.type === "queue.matched"));
  a.send("queue.join", { gameType });
  await sleep(100);
  b.send("queue.join", { gameType });
  const [{ payload }] = await Promise.all(matched);
  for (const client of [a, b]) {
    client.state = { matchId: payload.matchId, stateVersion: -1 };
    client.send("match.subscribe", { matchId: payload.matchId });
    await client.wait(
      (m) =>
        m.type === "match.snapshot" && m.payload.matchId === payload.matchId,
    );
  }
  const turns = new Map([
    [a, 0],
    [b, 0],
  ]);
  while (a.state.status !== "finished") {
    const mover = [a, b].find(
      (c) =>
        c.state.currentPlayerId === c.user.id && c.state.status === "playing",
    );
    if (!mover) {
      await sleep(20);
      continue;
    }
    const version = mover.state.stateVersion;
    const commandId = randomUUID();
    mover.send("game.command", {
      matchId: payload.matchId,
      gameType,
      commandId,
      expectedVersion: version,
      action: nextAction(mover, gameType, plan, turns.get(mover)),
    });
    turns.set(mover, turns.get(mover) + 1);
    const reply = await mover.wait(
      (m) =>
        (m.type === "game.ack" || m.type === "game.error") &&
        m.payload.commandId === commandId,
    );
    if (reply.type === "game.error")
      throw new Error(`${gameType} command rejected: ${reply.payload.code}`);
    while (
      [a, b].some((c) => c.state.stateVersion <= version) &&
      a.state.status !== "finished"
    )
      await sleep(10);
  }
  for (const client of [a, b])
    client.send("match.unsubscribe", { matchId: payload.matchId });
  return a.state;
}

const names = ["alice", "bob", "carol", "dave"];
const users = [];
for (const name of names) users.push(await prepareUser(name));
const clients = Object.fromEntries(
  await Promise.all(users.map(async (u) => [u.name, await connect(u)])),
);
const nicknameOf = new Map(users.map((u) => [u.id, u.nickname]));

// alice reaches 10 gomoku matches (first-win and 10-match progress).
const schedule = [
  ...Array.from({ length: 7 }, (_, i) => [
    "gomoku",
    "alice",
    "bob",
    { winner: i % 3 === 2 ? "bob" : "alice" },
  ]),
  ["gomoku", "alice", "carol", { winner: "alice" }],
  ["gomoku", "alice", "carol", { winner: "carol" }],
  ["gomoku", "alice", "carol", { winner: "alice", resign: true }],
  ["gomoku", "bob", "dave", { winner: "dave" }],
  ["gomoku", "bob", "dave", { winner: "bob" }],
  ["othello", "carol", "dave"],
  ["othello", "carol", "dave"],
  ["othello", "alice", "bob"],
];
for (const [gameType, x, y, plan] of schedule) {
  const state = await playMatch(gameType, clients[x], clients[y], plan);
  const winner = state.result?.winnerId
    ? nicknameOf.get(state.result.winnerId)
    : (state.result?.outcome ?? "?");
  console.log(
    `${gameType} ${clients[x].user.nickname} vs ${clients[y].user.nickname}: ${winner} (${state.result?.reason ?? "?"})`,
  );
}
for (const client of Object.values(clients)) client.socket.close();

for (const gameType of ["gomoku", "othello"]) {
  const response = await fetch(
    `${baseUrl}/api/leaderboard?gameType=${gameType}`,
    { headers: { authorization: `Bearer ${users[0].token}` } },
  );
  const rows = await response.json();
  console.log(`leaderboard ${gameType}:`);
  for (const row of Array.isArray(rows) ? rows : (rows.entries ?? []))
    console.log(`  ${JSON.stringify(row)}`);
}
