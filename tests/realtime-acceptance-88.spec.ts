import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import type {
  GameSnapshot,
  GameType,
  GomokuSnapshot,
} from "@cafe/game-contracts";
import type {
  GameStats,
  LeaderboardEntry,
  MatchPage,
} from "../apps/web/src/api/profile-api.ts";
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

async function pair(
  first: Client,
  second: Client,
  gameType: GameType = "gomoku",
) {
  const offsets = [first.messages.length, second.messages.length];
  for (const client of [first, second]) {
    const joined = await client.request("queue.join", { gameType });
    expect(joined.type).toBe("queue.joined");
  }
  const matched = await Promise.all([
    first.wait("queue.matched", () => true, offsets[0]),
    second.wait("queue.matched", () => true, offsets[1]),
  ]);
  const matchId = matched[0].payload.matchId as number;
  expect(matched[1].payload.matchId).toBe(matchId);
  for (const message of matched)
    expect(message.payload.gameType).toBe(gameType);
  const snapshots = await Promise.all(
    [first, second].map(async (client) => {
      const response = await client.request("match.subscribe", { matchId });
      expect(response.type).toBe("match.snapshot");
      expect(response.payload.gameType).toBe(gameType);
      return response.payload as unknown as GameSnapshot;
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

test("AT-09: simultaneous Gomoku and Othello matches isolate queues, commands and updates", async ({
  request,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One real matchmaking cohort");
  const accounts: { id: number }[] = [];
  const clients: Client[] = [];
  try {
    for (let index = 0; index < 4; index++) {
      const nickname = `mix88_${randomUUID().slice(0, 8)}`;
      const credentials = {
        email: `${nickname}@example.test`,
        password: `Test-${randomUUID()}`,
      };
      const registered = await request.post("/api/auth/register", {
        data: { ...credentials, nickname },
      });
      expect(registered.status()).toBe(201);
      accounts.push(await registered.json());
      const login = await request.post("/api/auth/login", {
        data: credentials,
      });
      expect(login.status()).toBe(200);
      const { accessToken } = await login.json();
      clients.push(await connect(baseURL!, accessToken));
    }
    const matches = await Promise.all([
      pair(clients[0], clients[1], "gomoku"),
      pair(clients[2], clients[3], "othello"),
    ]);
    expect(matches[0].matchId).not.toBe(matches[1].matchId);
    const blackClients = matches.map(
      ({ snapshot }) =>
        clients[
          accounts.findIndex((account) => account.id === snapshot.players.black)
        ],
    );
    for (const [index, match] of matches.entries()) {
      const denied = await blackClients[index].request("match.subscribe", {
        matchId: matches[1 - index].matchId,
      });
      expect(denied.type).toBe("error");
      expect(denied.payload.code).toBe("NOT_PARTICIPANT");
      const mismatch = await blackClients[index].request("game.command", {
        ...place(match.matchId, 2, 3),
        gameType: matches[1 - index].snapshot.gameType,
      });
      expect(mismatch.type).toBe("error");
      expect(mismatch.payload.code).toBe("INVALID_MESSAGE");
    }
    const acknowledgements = await Promise.all(
      matches.map((match, index) =>
        blackClients[index].request("game.command", {
          ...place(match.matchId, index === 0 ? 7 : 2, index === 0 ? 7 : 3),
          gameType: match.snapshot.gameType,
        }),
      ),
    );
    for (const ack of acknowledgements) {
      expect(ack.type).toBe("game.ack");
      expect(ack.payload).toMatchObject({ stateVersion: 1, duplicate: false });
    }
    for (const [index, client] of clients.entries()) {
      const match = matches[index < 2 ? 0 : 1];
      const updated = await client.wait(
        "game.updated",
        (message) =>
          message.payload.matchId === match.matchId &&
          message.payload.stateVersion === 1,
      );
      const snapshot = updated.payload as unknown as GameSnapshot;
      expect(snapshot.gameType).toBe(index < 2 ? "gomoku" : "othello");
      expect(snapshot.board).toHaveLength(index < 2 ? 15 : 8);
      if (index < 2) expect(snapshot.board[7][7]).toBe("black");
      else {
        expect(snapshot.board[2][3]).toBe("black");
        expect(snapshot.board[3][3]).toBe("black");
        expect(
          snapshot.board.flat().filter((cell) => cell === "black"),
        ).toHaveLength(4);
        expect(
          snapshot.board.flat().filter((cell) => cell === "white"),
        ).toHaveLength(1);
      }
    }
    await Promise.all(
      matches.map(async (match, index) => {
        const response = await blackClients[index].request("game.command", {
          matchId: match.matchId,
          gameType: match.snapshot.gameType,
          commandId: randomUUID(),
          expectedVersion: 1,
          action: { type: "resign" },
        });
        expect(response.type).toBe("game.ack");
      }),
    );
    for (const [index, client] of clients.entries()) {
      const match = matches[index < 2 ? 0 : 1];
      const terminal = await client.wait(
        "game.updated",
        (message) =>
          message.payload.matchId === match.matchId &&
          message.payload.status === "finished",
      );
      expect(terminal.payload).toMatchObject({
        gameType: match.snapshot.gameType,
        stateVersion: 2,
        result: {
          outcome: "win",
          reason: "resign",
          winnerId: match.snapshot.players.white,
        },
      });
      expect(
        client.messages
          .filter((m) => m.type === "game.updated")
          .every((m) => m.payload.matchId === match.matchId),
      ).toBe(true);
      expect(client.errors).toEqual([]);
    }
    await testInfo.attach("actual-mixed-games-summary", {
      body: JSON.stringify({
        accountIds: accounts.map((account) => account.id),
        matches: matches.map((match) => ({
          matchId: match.matchId,
          gameType: match.snapshot.gameType,
          players: match.snapshot.players,
        })),
        checks: [
          "concurrent queues",
          "foreign subscription denied",
          "wrong gameType denied",
          "real place/flip",
          "only own updates",
          "both matches finished",
        ],
      }),
      contentType: "application/json",
    });
  } finally {
    for (const client of clients) client.socket.terminate();
  }
});

test("AT-08: actual matches persist first-win, 10-match progress, history and deterministic leaderboard ties", async ({
  request,
  page,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One real matchmaking cohort");
  test.setTimeout(120_000);
  const accounts: {
    id: number;
    nickname: string;
    email: string;
    password: string;
    accessToken: string;
  }[] = [];
  const clients: Client[] = [];
  const matches: {
    matchId: number;
    black: number;
    white: number;
    winnerId: number;
    reason: string;
  }[] = [];
  const checkpoints: { played: number; stats: GameStats[] }[] = [];
  const histories: { userId: number; records: MatchPage["matches"] }[] = [];
  const get = async <T>(path: string): Promise<T> => {
    const response = await request.get(path, {
      headers: { authorization: `Bearer ${accounts[0].accessToken}` },
    });
    expect(response.status(), path).toBe(200);
    return response.json();
  };
  const stats = (index: number, gameType = "gomoku") =>
    get<GameStats>(
      `/api/users/${accounts[index].id}/stats?gameType=${gameType}`,
    );
  const verifyStats = async (index: number, wins: number, losses: number) => {
    const result = await stats(index);
    const played = wins + losses;
    expect(result).toEqual({
      userId: accounts[index].id,
      gameType: "gomoku",
      wins,
      losses,
      draws: 0,
      played,
      winRate: played ? wins / played : 0,
      achievements: { firstWin: wins > 0 },
      progress: { current: Math.min(played, 10), target: 10 },
    });
    return result;
  };
  const finish = async (
    first: number,
    second: number,
    winner: number,
    normalWin = false,
  ) => {
    const { matchId, snapshot: initial } = await pair(
      clients[first],
      clients[second],
    );
    let snapshot = initial;
    while (snapshot.status !== "finished") {
      const version = snapshot.stateVersion;
      const actor = normalWin
        ? accounts.findIndex(
            (account) => account.id === snapshot.currentPlayerId,
          )
        : winner === first
          ? second
          : first;
      const winningMove = actor === winner;
      const reply = await clients[actor].request("game.command", {
        matchId,
        gameType: "gomoku",
        commandId: randomUUID(),
        expectedVersion: version,
        action: normalWin
          ? {
              type: "place",
              row: winningMove ? 7 : 0,
              col: Math.floor(version / 2) * (winningMove ? 1 : 2),
            }
          : { type: "resign" },
      });
      expect(reply.type).toBe("game.ack");
      expect(reply.payload).toMatchObject({
        stateVersion: version + 1,
        duplicate: false,
      });
      const updates = await Promise.all(
        [first, second].map((index) =>
          clients[index].wait(
            "game.updated",
            (message) =>
              message.payload.matchId === matchId &&
              message.payload.stateVersion === version + 1,
          ),
        ),
      );
      expect(updates[0].payload).toEqual(updates[1].payload);
      snapshot = updates[0].payload as unknown as GomokuSnapshot;
      expect(snapshot.stateVersion).toBeLessThanOrEqual(normalWin ? 10 : 1);
    }
    const reason = normalWin ? "five_in_row" : "resign";
    expect(snapshot.result).toEqual({
      outcome: "win",
      winnerId: accounts[winner].id,
      reason,
    });
    matches.push({
      matchId,
      ...snapshot.players,
      winnerId: accounts[winner].id,
      reason,
    });
  };
  const leaderboard = async () => {
    const entries = await get<LeaderboardEntry[]>(
      "/api/leaderboard?gameType=gomoku&limit=100",
    );
    expect(entries.map((entry) => entry.rank)).toEqual(
      entries.map((_, index) => index + 1),
    );
    expect(entries).toEqual(
      [...entries].sort(
        (a, b) =>
          b.wins - a.wins || b.winRate - a.winRate || a.userId - b.userId,
      ),
    );
    return entries.filter((entry) =>
      accounts.some((a) => a.id === entry.userId),
    );
  };
  try {
    // ID와 닉네임 순서를 반대로 만들어 닉네임 정렬 회귀도 검출합니다.
    for (const letter of ["z", "y", "b", "a"]) {
      const nickname = `s88_${letter}_${randomUUID().slice(0, 8)}`;
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
      accounts.push({ id, nickname, ...credentials, accessToken });
      clients.push(await connect(baseURL!, accessToken));
    }
    await verifyStats(0, 0, 0);
    await verifyStats(1, 0, 0);
    for (let round = 1; round <= 10; round++) {
      await finish(0, 1, round <= 6 ? 0 : 1, round === 1);
      if ([1, 4, 10].includes(round)) {
        checkpoints.push({
          played: round,
          stats: await Promise.all([
            verifyStats(0, Math.min(round, 6), Math.max(0, round - 6)),
            verifyStats(1, Math.max(0, round - 6), Math.min(round, 6)),
          ]),
        });
      }
    }
    for (let round = 1; round <= 10; round++) {
      await finish(2, 3, round <= 4 ? 2 : 3);
      if (round === 4) {
        const entries = await leaderboard();
        const b = entries.find((entry) => entry.userId === accounts[1].id)!;
        const c = entries.find((entry) => entry.userId === accounts[2].id)!;
        expect(b).toMatchObject({ wins: 4, played: 10, winRate: 0.4 });
        expect(c).toMatchObject({ wins: 4, played: 4, winRate: 1 });
        expect(c.rank).toBeLessThan(b.rank);
      }
    }
    const tiedLeaderboard = await leaderboard();
    expect(tiedLeaderboard.map((entry) => entry.userId)).toEqual(
      [0, 3, 1, 2].map((index) => accounts[index].id),
    );
    for (const [index, wins] of [6, 4, 4, 6].entries()) {
      await verifyStats(index, wins, 10 - wins);
    }
    await finish(0, 1, 0);
    await verifyStats(0, 7, 4);
    await verifyStats(1, 4, 7);
    for (let index = 0; index < accounts.length; index++) {
      expect(await stats(index, "othello")).toMatchObject({
        wins: 0,
        losses: 0,
        draws: 0,
        played: 0,
        achievements: { firstWin: false },
        progress: { current: 0, target: 10 },
      });
      const records: MatchPage["matches"] = [];
      let before: number | null = null;
      do {
        const result: MatchPage = await get(
          `/api/users/${accounts[index].id}/matches?gameType=gomoku&limit=4${before === null ? "" : `&before=${before}`}`,
        );
        expect(result.matches.length).toBeGreaterThan(0);
        expect(result.matches.length).toBeLessThanOrEqual(4);
        records.push(...result.matches);
        expect(records.length).toBeLessThanOrEqual(11);
        before = result.nextBefore;
      } while (before !== null);
      const expected = matches
        .filter((match) =>
          [match.black, match.white].includes(accounts[index].id),
        )
        .reverse();
      expect(records.map((record) => record.matchId)).toEqual(
        expected.map((match) => match.matchId),
      );
      for (const [position, record] of records.entries()) {
        const match = expected[position];
        const opponentId =
          match.black === accounts[index].id ? match.white : match.black;
        expect(record).toMatchObject({
          gameType: "gomoku",
          result: match.winnerId === accounts[index].id ? "win" : "loss",
          reason: match.reason,
          seat: match.black === accounts[index].id ? "black" : "white",
          opponent: {
            id: opponentId,
            nickname: accounts.find((a) => a.id === opponentId)!.nickname,
            deleted: false,
          },
        });
        expect(Number.isFinite(Date.parse(record.finishedAt))).toBe(true);
      }
      histories.push({ userId: accounts[index].id, records });
    }
    await page.goto("/");
    await page.locator("#emailInput").fill(accounts[0].email);
    await page.locator("#passwordInput").fill(accounts[0].password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page.getByTestId("lobby-view")).toBeVisible();
    await page
      .getByTestId("lobby-view")
      .getByRole("button", { name: "내 프로필", exact: true })
      .click();
    for (let read = 0; read < 2; read++) {
      await expect(
        page.locator('.cbc-profile-game-card[data-game="gomoku"]'),
      ).toContainText("참여 진행도 10 / 10");
      await expect(page.locator(".cbc-profile-total")).toContainText(
        "총 11전 7승 4패 0무",
      );
      for (const name of ["첫 승리", "10경기 참여"]) {
        await expect(
          page
            .locator(".cbc-achievements li")
            .filter({ has: page.getByText(name, { exact: true }) }),
        ).toHaveClass("is-done");
      }
      await verifyStats(0, 7, 4);
      if (read === 0) await page.reload();
    }
    await testInfo.attach("actual-stats-summary", {
      body: JSON.stringify(
        {
          accountIds: accounts.map((account) => account.id),
          matches,
          checkpoints,
          histories,
          tiedLeaderboard,
          totalFinished: matches.length,
          ui: "Chrome profile, first-win and 10-match achievements persist after reload; 11 played caps progress at 10",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    for (const client of clients) expect(client.errors).toEqual([]);
  } finally {
    for (const client of clients) client.socket.terminate();
  }
});

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
