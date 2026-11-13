import { describe, expect, test, vi } from "vitest";
import type { WebSocket } from "ws";
import type { GameCommandService } from "./game-command-service.ts";
import { createMatchmaking } from "./matchmaking.ts";

function fakeSocket() {
  return { OPEN: 1, readyState: 1 } as unknown as WebSocket;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(
  options: { active?: number[]; createMatch?: () => Promise<number> } = {},
) {
  let nextMatchId = 100;
  const games = {
    createMatch: vi.fn(options.createMatch ?? (async () => nextMatchId++)),
    findActiveMatchId: vi.fn(
      async (userId: number): Promise<number | undefined> =>
        options.active?.includes(userId) ? 1 : undefined,
    ),
  };
  // `to` is a socket for send() and a user ID for notifyUser().
  const sent: { to: WebSocket | number; type: string; payload: object }[] = [];
  const onError = vi.fn();
  const matchmaking = createMatchmaking({
    getGames: () => games as unknown as GameCommandService,
    send: (to, type, payload) => sent.push({ to, type, payload }),
    notifyUser: (to, type, payload) => sent.push({ to, type, payload }),
    onError,
    random: () => 0,
  });
  return { matchmaking, games, sent, onError };
}

describe("matchmaking", () => {
  test("two players of the same game are matched and both notified", async () => {
    const { matchmaking, games, sent } = setup();
    const [s1, s2] = [fakeSocket(), fakeSocket()];

    expect(await matchmaking.join(1, s1, "gomoku")).toBe("joined");
    expect(games.createMatch).not.toHaveBeenCalled();
    expect(await matchmaking.join(2, s2, "gomoku")).toBe("joined");
    await flush();

    expect(games.createMatch).toHaveBeenCalledExactlyOnceWith({
      gameType: "gomoku",
      blackUserId: 1,
      whiteUserId: 2,
    });
    expect(sent).toEqual([
      {
        to: 1,
        type: "queue.matched",
        payload: { matchId: 100, gameType: "gomoku" },
      },
      {
        to: 2,
        type: "queue.matched",
        payload: { matchId: 100, gameType: "gomoku" },
      },
    ]);
    expect(matchmaking.isQueued(1)).toBe(false);
    expect(matchmaking.isQueued(2)).toBe(false);
  });

  test("colors come from the random source", async () => {
    let roll = 0.9;
    const games = {
      createMatch: vi.fn(async () => 1),
      findActiveMatchId: vi.fn(async () => undefined),
    };
    const matchmaking = createMatchmaking({
      getGames: () => games as unknown as GameCommandService,
      send: () => {},
      notifyUser: () => {},
      onError: () => {},
      random: () => roll,
    });
    await matchmaking.join(1, fakeSocket(), "gomoku");
    await matchmaking.join(2, fakeSocket(), "gomoku");
    await flush();
    roll = 0.1;
    await matchmaking.join(3, fakeSocket(), "gomoku");
    await matchmaking.join(4, fakeSocket(), "gomoku");
    await flush();
    expect(games.createMatch.mock.calls).toEqual([
      [{ gameType: "gomoku", blackUserId: 2, whiteUserId: 1 }],
      [{ gameType: "gomoku", blackUserId: 3, whiteUserId: 4 }],
    ]);
  });

  test("different games use separate queues, and a third player waits", async () => {
    const { matchmaking, games } = setup();
    await matchmaking.join(1, fakeSocket(), "gomoku");
    await matchmaking.join(2, fakeSocket(), "othello");
    await flush();
    expect(games.createMatch).not.toHaveBeenCalled();

    await matchmaking.join(3, fakeSocket(), "gomoku");
    await matchmaking.join(4, fakeSocket(), "gomoku");
    await flush();
    expect(games.createMatch).toHaveBeenCalledOnce();
    expect(matchmaking.isQueued(4)).toBe(true);
    expect(matchmaking.isQueued(2)).toBe(true);
  });

  test("a queued or playing user cannot join again", async () => {
    const { matchmaking } = setup({ active: [9] });
    await matchmaking.join(1, fakeSocket(), "gomoku");
    expect(await matchmaking.join(1, fakeSocket(), "othello")).toBe(
      "ALREADY_ACTIVE",
    );
    expect(await matchmaking.join(9, fakeSocket(), "gomoku")).toBe(
      "ALREADY_ACTIVE",
    );
  });

  test("concurrent joins of one user enqueue only one entry", async () => {
    const { matchmaking } = setup();
    const results = await Promise.all([
      matchmaking.join(1, fakeSocket(), "gomoku"),
      matchmaking.join(1, fakeSocket(), "gomoku"),
    ]);
    expect(results.sort()).toEqual(["ALREADY_ACTIVE", "joined"]);
  });

  test("a second join of the same user is refused while the first checks the DB", async () => {
    let release!: () => void;
    const { matchmaking, games } = setup();
    games.findActiveMatchId.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(undefined))),
    );
    // Another tab joins while the first lookup is pending. Before the fix
    // its lookup could read the DB from before the first join's match.
    const first = matchmaking.join(1, fakeSocket(), "gomoku");
    expect(await matchmaking.join(1, fakeSocket(), "gomoku")).toBe(
      "ALREADY_ACTIVE",
    );
    release();
    expect(await first).toBe("joined");
  });

  test("leaving or closing the socket before a pair forms removes the entry", async () => {
    const { matchmaking, games } = setup();
    const closing = fakeSocket();
    await matchmaking.join(1, fakeSocket(), "gomoku");
    expect(matchmaking.leave(1)).toBe("left");
    expect(matchmaking.leave(1)).toBe("left");
    await matchmaking.join(2, closing, "gomoku");
    matchmaking.removeSocket(closing);

    await matchmaking.join(3, fakeSocket(), "gomoku");
    await flush();
    expect(games.createMatch).not.toHaveBeenCalled();
    expect(matchmaking.isQueued(3)).toBe(true);
  });

  test("a leave from another tab cancels a join still checking the DB", async () => {
    let release!: () => void;
    const { matchmaking, games } = setup();
    games.findActiveMatchId.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(undefined))),
    );
    const join = matchmaking.join(1, fakeSocket(), "gomoku");
    expect(matchmaking.leave(1)).toBe("left");
    release();
    expect(await join).toBe("cancelled");
    expect(matchmaking.isQueued(1)).toBe(false);

    // The cancel applies only to that join.
    expect(await matchmaking.join(1, fakeSocket(), "gomoku")).toBe("joined");
  });

  test("a socket closed during the active-match lookup is not queued", async () => {
    const { matchmaking } = setup();
    const socket = fakeSocket();
    const join = matchmaking.join(1, socket, "gomoku");
    (socket as { readyState: number }).readyState = 3;
    expect(await join).toBe("closed");
    expect(matchmaking.isQueued(1)).toBe(false);
  });

  test("once a pair is being created it is too late to leave or rejoin", async () => {
    let finish!: (matchId: number) => void;
    const { matchmaking, sent } = setup({
      createMatch: () => new Promise<number>((resolve) => (finish = resolve)),
    });
    const s1 = fakeSocket();
    await matchmaking.join(1, s1, "gomoku");
    await matchmaking.join(2, fakeSocket(), "gomoku");

    expect(matchmaking.leave(1)).toBe("ALREADY_MATCHED");
    expect(await matchmaking.join(1, fakeSocket(), "gomoku")).toBe(
      "ALREADY_ACTIVE",
    );
    // Closing does not cancel it either; the match still starts.
    matchmaking.removeSocket(s1);
    finish(7);
    await flush();
    expect(sent.map((m) => m.type)).toEqual(["queue.matched", "queue.matched"]);
  });

  test("a failed createMatch returns both players to idle", async () => {
    const { matchmaking, sent, onError } = setup({
      createMatch: async () => {
        throw new Error("db down");
      },
    });
    await matchmaking.join(1, fakeSocket(), "gomoku");
    await matchmaking.join(2, fakeSocket(), "gomoku");
    await flush();

    expect(onError).toHaveBeenCalledOnce();
    expect(
      sent.map((m) => [m.type, (m.payload as { code: string }).code]),
    ).toEqual([
      ["error", "INTERNAL_ERROR"],
      ["error", "INTERNAL_ERROR"],
    ]);
    expect(matchmaking.isQueued(1)).toBe(false);
    expect(await matchmaking.join(1, fakeSocket(), "gomoku")).toBe("joined");
  });
});
