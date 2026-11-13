import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { gomoku, othello } from "@cafe/game-engine";
import { buildApp } from "./app.ts";
import { gameEngines } from "./engines.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "./test-support/database.ts";

const jwtSecret = "test-secret-test-secret-test-secret";
const password = "password-123";

type Message = { type: string; payload: Record<string, unknown> };

// Buffers every message so several replies in a row are not missed.
function inbox(socket: WebSocket) {
  const queue: Message[] = [];
  const waiting: ((message: Message) => void)[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queue.push(message);
  });
  // Skips messages until one of the given type arrives.
  return async function next(type?: string): Promise<Message> {
    for (;;) {
      const message =
        queue.shift() ??
        (await new Promise<Message>((resolve) => waiting.push(resolve)));
      if (!type || message.type === type) return message;
    }
  };
}

test("the gomoku and othello engines are registered in the IF-04 format", () => {
  expect(gameEngines.gomoku).toMatchObject({
    version: gomoku.GOMOKU_RULES_VERSION,
  });
  expect(gameEngines.gomoku?.rules).toBe(gomoku.rules);
  expect(gameEngines.gomoku?.board).toBe(gomoku.board);
  expect(gameEngines.othello).toMatchObject({
    version: othello.OTHELLO_RULES_VERSION,
  });
  expect(gameEngines.othello?.rules).toBe(othello.rules);
  expect(gameEngines.othello?.board).toBe(othello.board);
});

describe.skipIf(!testDatabaseUrl)("registered engines end to end", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await openTestDatabase();
    await resetTestDatabase(database);
    app = await buildApp(
      {},
      testDatabaseUrl,
      { jwtSecret },
      undefined,
      {},
      gameEngines,
    );
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  async function connect(n: number) {
    const email = `p${n}@example.com`;
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password, nickname: `p${n}` },
    });
    const { accessToken } = (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password },
      })
    ).json();
    const socket = await app.injectWS("/api/ws");
    const next = inbox(socket);
    socket.send(JSON.stringify({ type: "auth", payload: { accessToken } }));
    const { payload } = await next("auth.ok");
    return { socket, next, userId: payload.userId as number };
  }

  // Queues two new players for the game and subscribes both to the match.
  async function startMatch(gameType: "gomoku" | "othello", n: number) {
    const players = [await connect(n), await connect(n + 1)];
    for (const { socket } of players) {
      socket.send(
        JSON.stringify({ type: "queue.join", payload: { gameType } }),
      );
    }
    const matched = await players[0].next("queue.matched");
    const matchId = matched.payload.matchId as number;
    await players[1].next("queue.matched");

    let snapshot: Record<string, unknown> = {};
    for (const { socket, next } of players) {
      socket.send(
        JSON.stringify({ type: "match.subscribe", payload: { matchId } }),
      );
      snapshot = (await next("match.snapshot")).payload;
    }
    const seats = snapshot.players as { black: number; white: number };
    const black = players.find((p) => p.userId === seats.black)!;
    const white = players.find((p) => p.userId === seats.white)!;

    let version = 0;
    // Sends one placement and returns the reply that answers it, skipping
    // broadcasts of the opponent's earlier moves.
    const place = async (player: typeof black, row: number, col: number) => {
      player.socket.send(
        JSON.stringify({
          type: "game.command",
          payload: {
            matchId,
            gameType,
            commandId: randomUUID(),
            expectedVersion: version,
            action: { type: "place", row, col },
          },
        }),
      );
      for (;;) {
        const reply = await player.next();
        if (reply.type === "game.ack" || reply.type === "game.error") {
          return reply;
        }
      }
    };
    const play = async (player: typeof black, row: number, col: number) => {
      expect(await place(player, row, col)).toMatchObject({
        type: "game.ack",
        payload: { stateVersion: version + 1 },
      });
      version++;
      return (await player.next("game.updated")).payload;
    };
    const close = () => players.forEach(({ socket }) => socket.terminate());
    return { snapshot, seats, black, white, place, play, close };
  }

  test("two queued players are matched and play gomoku to five in a row", async () => {
    const { snapshot, seats, black, white, play, close } = await startMatch(
      "gomoku",
      1,
    );
    expect(snapshot).toMatchObject({
      rulesVersion: gomoku.GOMOKU_RULES_VERSION,
      status: "playing",
    });

    // Black builds row 7, white plays on row 0, alternating.
    for (let col = 0; col < 4; col++) {
      await play(black, 7, col);
      await play(white, 0, col);
    }
    const final = await play(black, 7, 4);
    expect(final).toMatchObject({
      status: "finished",
      result: { outcome: "win", winnerId: seats.black, reason: "five_in_row" },
    });
    close();
  });

  test("two queued players are matched and play othello with flips", async () => {
    const { snapshot, seats, black, place, play, close } = await startMatch(
      "othello",
      3,
    );
    expect(snapshot).toMatchObject({
      rulesVersion: othello.OTHELLO_RULES_VERSION,
      status: "playing",
      currentPlayerId: seats.black,
      board: othello.createInitialState().board,
    });

    // A corner flips nothing at the start, so the engine refuses it.
    expect(await place(black, 0, 0)).toMatchObject({
      type: "game.error",
      payload: { code: "INVALID_ACTION" },
    });

    // The first legal move for black, as the engine sees it.
    const initial = othello.createInitialState();
    const cells = initial.board.flatMap((line, row) =>
      line.map((_, col) => ({ row, col })),
    );
    const move = cells.find(
      ({ row, col }) =>
        othello.applyMove(initial, { type: "place", row, col }, "black").ok,
    )!;
    const updated = await play(black, move.row, move.col);
    expect(updated).toMatchObject({
      status: "playing",
      currentPlayerId: seats.white,
      board: othello.board([{ ...move, stone: "black" }]),
    });
    close();
  });
});
