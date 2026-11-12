import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import type { GomokuSnapshot } from "@cafe/game-contracts";
import WebSocket from "ws";

type Message = {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
};

// 실제 인증 요청의 비밀번호·토큰이 실패 trace에 포함되지 않게 합니다.
test.use({ trace: "off", screenshot: "off", video: "off" });

async function connect(baseURL: string, accessToken: string, autoPong = true) {
  const url = new URL("/api/ws", baseURL);
  url.protocol = "wss:";
  const socket = new WebSocket(url, { autoPong });
  const messages: Message[] = [];
  const errors: string[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  socket.on("error", (error) => errors.push(error.message));
  const wait = async (
    type: string,
    accepts: (message: Message) => boolean = () => true,
    after = 0,
    timeout = 10_000,
  ) => {
    let found: Message | undefined;
    await expect
      .poll(
        () => {
          found = messages
            .slice(after)
            .find((m) => m.type === type && accepts(m));
          return Boolean(found);
        },
        { timeout, message: `Actual WSS must receive ${type}` },
      )
      .toBe(true);
    return found!;
  };
  const send = (type: string, payload: Record<string, unknown>) => {
    const requestId = randomUUID();
    socket.send(JSON.stringify({ type, requestId, payload }));
    return requestId;
  };
  const request = async (type: string, payload: Record<string, unknown>) => {
    const after = messages.length;
    const requestId = send(type, payload);
    let found: Message | undefined;
    await expect
      .poll(
        () => {
          found = messages.slice(after).find((m) => m.requestId === requestId);
          return Boolean(found);
        },
        { timeout: 10_000, message: `Actual WSS must answer ${type}` },
      )
      .toBe(true);
    return found!;
  };
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const authenticated = await request("auth", { accessToken });
  expect(authenticated.type).toBe("auth.ok");
  return { socket, messages, errors, wait, send, request };
}

type Client = Awaited<ReturnType<typeof connect>>;

async function pair(first: Client, second: Client) {
  for (const client of [first, second]) {
    const joined = await client.request("queue.join", { gameType: "gomoku" });
    expect(joined.type).toBe("queue.joined");
  }
  const matched = await Promise.all([
    first.wait("queue.matched"),
    second.wait("queue.matched"),
  ]);
  const matchId = matched[0].payload.matchId as number;
  expect(matched[1].payload.matchId).toBe(matchId);
  const snapshots = await Promise.all(
    [first, second].map(async (client) => {
      const response = await client.request("match.subscribe", { matchId });
      expect(response.type).toBe("match.snapshot");
      return response.payload as unknown as GomokuSnapshot;
    }),
  );
  expect(snapshots[0].stateVersion).toBe(0);
  expect(snapshots[1].board).toEqual(snapshots[0].board);
  return { matchId, snapshot: snapshots[0] };
}

function place(matchId: number, row: number, col: number) {
  return {
    matchId,
    gameType: "gomoku",
    commandId: randomUUID(),
    expectedVersion: 0,
    action: { type: "place", row, col },
  };
}

test("AT-06/09: actual concurrent WSS matches stay isolated and consume a cumulative 60-second absence budget", async ({
  request,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One real matchmaking queue");
  test.setTimeout(150_000);
  expect(new URL(baseURL!).protocol).toBe("https:");
  const clients: Client[] = [];
  const accounts: { id: number; accessToken: string }[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const nickname = `rt88_${randomUUID().slice(0, 8)}`;
      const credentials = {
        email: `${nickname}@example.test`,
        password: `Test-${randomUUID()}`,
      };
      const registered = await request.post("/api/auth/register", {
        data: { ...credentials, nickname },
      });
      expect(registered.status()).toBe(201);
      const { id } = (await registered.json()) as { id: number };
      const loggedIn = await request.post("/api/auth/login", {
        data: credentials,
      });
      expect(loggedIn.status()).toBe(200);
      const { accessToken } = (await loggedIn.json()) as {
        accessToken: string;
      };
      accounts.push({ id, accessToken });
      clients.push(await connect(baseURL!, accessToken));
    }
    const first = await pair(clients[0], clients[1]);
    const second = await pair(clients[2], clients[3]);
    expect(second.matchId).not.toBe(first.matchId);
    const blackIndex = accounts.findIndex(
      (a) => a.id === first.snapshot.players.black,
    );
    const whiteIndex = blackIndex === 0 ? 1 : 0;
    const black = clients[blackIndex];
    const white = clients[whiteIndex];
    const secondBlack =
      clients[
        accounts.findIndex((a) => a.id === second.snapshot.players.black)
      ];

    const denied = await black.request("match.subscribe", {
      matchId: second.matchId,
    });
    expect(denied.type).toBe("error");
    expect(denied.payload.code).toBe("NOT_PARTICIPANT");
    const outsider = await black.request(
      "game.command",
      place(second.matchId, 7, 7),
    );
    expect(outsider.type).toBe("game.error");
    expect(outsider.payload.code).toBe("NOT_SUBSCRIBED");

    const firstMove = place(first.matchId, 7, 7);
    const secondMove = place(second.matchId, 6, 6);
    const acknowledgements = await Promise.all([
      black.request("game.command", firstMove),
      secondBlack.request("game.command", secondMove),
    ]);
    for (const ack of acknowledgements) {
      expect(ack.type).toBe("game.ack");
      expect(ack.payload.stateVersion).toBe(1);
      expect(ack.payload.duplicate).toBe(false);
    }
    for (const [index, client] of clients.entries()) {
      const matchId = index < 2 ? first.matchId : second.matchId;
      const update = await client.wait(
        "game.updated",
        (m) => m.payload.matchId === matchId,
      );
      const snapshot = update.payload as unknown as GomokuSnapshot;
      expect(snapshot.stateVersion).toBe(1);
      expect(snapshot.board[index < 2 ? 7 : 6][index < 2 ? 7 : 6]).toBe(
        "black",
      );
      expect(snapshot.board[index < 2 ? 6 : 7][index < 2 ? 6 : 7]).toBeNull();
    }
    const replay = await black.request("game.command", firstMove);
    expect(replay.type).toBe("game.ack");
    expect(replay.payload).toMatchObject({ stateVersion: 1, duplicate: true });
    const stale = await white.request(
      "game.command",
      place(first.matchId, 0, 0),
    );
    expect(stale.type).toBe("game.error");
    expect(stale.payload.code).toBe("VERSION_CONFLICT");

    const beforeFirstDisconnect = white.messages.length;
    const absenceStarted = performance.now();
    black.socket.close();
    const disconnected = await white.wait(
      "player.disconnected",
      () => true,
      beforeFirstDisconnect,
    );
    const initialBudget = disconnected.payload.remainingMs as number;
    expect(initialBudget).toBeGreaterThan(59_000);
    expect(initialBudget).toBeLessThanOrEqual(60_000);
    await delay(8_000);
    const beforeReconnect = white.messages.length;
    const reconnected = await connect(
      baseURL!,
      accounts[blackIndex].accessToken,
    );
    clients.push(reconnected);
    const restored = await reconnected.request("match.subscribe", {
      matchId: first.matchId,
    });
    expect(restored.type).toBe("match.snapshot");
    const restoredSnapshot = restored.payload as unknown as GomokuSnapshot;
    expect(restoredSnapshot.stateVersion).toBe(1);
    expect(restoredSnapshot.board[7][7]).toBe("black");
    const returned = await white.wait(
      "player.reconnected",
      () => true,
      beforeReconnect,
    );
    const budgetAfterReconnect = returned.payload.remainingMs as number;
    expect(budgetAfterReconnect).toBeLessThan(initialBudget - 7_500);
    expect(budgetAfterReconnect).toBeGreaterThan(45_000);

    const beforeSecondDisconnect = white.messages.length;
    const secondAbsenceStarted = performance.now();
    reconnected.socket.close();
    const disconnectedAgain = await white.wait(
      "player.disconnected",
      () => true,
      beforeSecondDisconnect,
    );
    const secondBudget = disconnectedAgain.payload.remainingMs as number;
    expect(secondBudget).toBeLessThanOrEqual(budgetAfterReconnect);
    const terminal = await white.wait(
      "game.updated",
      (m) =>
        m.payload.matchId === first.matchId && m.payload.status === "finished",
      beforeSecondDisconnect,
      secondBudget + 10_000,
    );
    const totalElapsedMs = performance.now() - absenceStarted;
    const secondElapsedMs = performance.now() - secondAbsenceStarted;
    expect(secondElapsedMs).toBeGreaterThanOrEqual(secondBudget - 500);
    expect(secondElapsedMs).toBeLessThan(secondBudget + 5_000);
    expect(totalElapsedMs).toBeGreaterThan(59_500);
    expect(totalElapsedMs).toBeLessThan(67_000);
    const result = terminal.payload as unknown as GomokuSnapshot;
    expect(result.stateVersion).toBe(2);
    expect(result.result).toEqual({
      outcome: "win",
      winnerId: accounts[whiteIndex].id,
      reason: "disconnect_timeout",
    });

    const afterTimeout = await connect(
      baseURL!,
      accounts[blackIndex].accessToken,
    );
    clients.push(afterTimeout);
    const persisted = await afterTimeout.request("match.subscribe", {
      matchId: first.matchId,
    });
    expect(persisted.type).toBe("match.snapshot");
    expect(persisted.payload).toEqual(terminal.payload);
    for (const client of clients.slice(2, 4)) {
      expect(client.socket.readyState).toBe(WebSocket.OPEN);
      const snapshot = await client.request("match.subscribe", {
        matchId: second.matchId,
      });
      expect(snapshot.type).toBe("match.snapshot");
      expect(snapshot.payload).toMatchObject({
        status: "playing",
        stateVersion: 1,
      });
    }
    const resigned = await secondBlack.request("game.command", {
      matchId: second.matchId,
      gameType: "gomoku",
      commandId: randomUUID(),
      expectedVersion: 1,
      action: { type: "resign" },
    });
    expect(resigned.type).toBe("game.ack");
    await secondBlack.wait(
      "game.updated",
      (m) => m.payload.status === "finished",
    );
    for (const [index, client] of clients.entries()) {
      const ownMatch = index < 2 || index >= 4 ? first.matchId : second.matchId;
      expect(client.errors).toEqual([]);
      expect(
        client.messages
          .filter((m) => m.type === "game.updated")
          .every((m) => m.payload.matchId === ownMatch),
      ).toBe(true);
    }
    await testInfo.attach("actual-realtime-summary", {
      body: JSON.stringify(
        {
          accountIds: accounts.map((a) => a.id),
          matchIds: [first.matchId, second.matchId],
          initialBudgetMs: initialBudget,
          budgetAfterReconnectMs: budgetAfterReconnect,
          secondBudgetMs: secondBudget,
          secondElapsedMs,
          totalElapsedMs,
          isolation: "Only own-match game.updated frames received",
          transport: "wss with Node certificate validation enabled",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    for (const client of clients) client.socket.terminate();
  }
});

test("AT-06: 실제 ping에 응답하지 않는 연결은 마지막 메시지 후 20초에 감지된다", async ({
  request,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "실제 heartbeat 경계 검증");
  test.setTimeout(40_000);
  const accounts = [];
  const clients: Client[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const nickname = `hb88_${randomUUID().slice(0, 8)}`;
      const credentials = {
        email: `${nickname}@example.test`,
        password: `Test-${randomUUID()}`,
      };
      const registered = await request.post("/api/auth/register", {
        data: { ...credentials, nickname },
      });
      expect(registered.status()).toBe(201);
      const { id } = await registered.json();
      const login = await request.post("/api/auth/login", {
        data: credentials,
      });
      expect(login.status()).toBe(200);
      const { accessToken } = await login.json();
      accounts.push({ id, accessToken });
      // WS 클라이언트만 pong을 보내지 않으며 서버 타이머는 실제 기본값을 사용합니다.
      clients.push(await connect(baseURL!, accessToken, index !== 0));
    }
    const match = await pair(clients[0], clients[1]);
    const after = clients[1].messages.length;
    const started = performance.now();
    const disconnected = await clients[1].wait(
      "player.disconnected",
      () => true,
      after,
      25_000,
    );
    const detectionMs = performance.now() - started;
    expect(detectionMs).toBeGreaterThan(18_500);
    expect(detectionMs).toBeLessThan(22_500);
    const remainingMs = disconnected.payload.remainingMs as number;
    expect(remainingMs).toBeGreaterThan(37_500);
    expect(remainingMs).toBeLessThanOrEqual(40_500);
    const returned = await connect(baseURL!, accounts[0].accessToken);
    clients.push(returned);
    const restored = await returned.request("match.subscribe", {
      matchId: match.matchId,
    });
    expect(restored.type).toBe("match.snapshot");
    const resumed = await returned.wait(
      "match.snapshot",
      (message) => message.payload.status === "playing",
    );
    expect(resumed.payload.matchId).toBe(match.matchId);
    const resigned = await returned.request("game.command", {
      matchId: match.matchId,
      gameType: "gomoku",
      commandId: randomUUID(),
      expectedVersion: 0,
      action: { type: "resign" },
    });
    expect(resigned.type).toBe("game.ack");
    await returned.wait("game.updated", (m) => m.payload.status === "finished");
    await testInfo.attach("actual-heartbeat-summary", {
      body: JSON.stringify({
        accountIds: accounts.map((a) => a.id),
        matchId: match.matchId,
        detectionMs,
        remainingMs,
        heartbeatIntervalMs: 10_000,
        heartbeatTimeoutMs: 20_000,
        clock: "real, unchanged",
      }),
      contentType: "application/json",
    });
  } finally {
    for (const client of clients) client.socket.terminate();
  }
});
