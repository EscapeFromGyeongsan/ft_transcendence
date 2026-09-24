import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { adaptGame, type GameDefinition } from "./definition";
import { omok, omokDefinition } from "./omok";
import { GameRegistry, gameRegistry } from "./registry";
import { RoomStore } from "../rooms";
import { buildApp } from "../app";
import { openDatabase } from "../db/database";
import { history, saveResult } from "../history";
import type { RoomSnapshot } from "@cafe/game-contracts";

// Deliberately no board, colors, Omok action names, alternating turns or fixed two-seat rule.
// This fixture never enters the production registry or UI.
type CounterState = {
  stateVersion: number;
  score: number;
  winner: number | null;
};
const counter: GameDefinition<CounterState, { type: "ADD_POINT" }> = {
  gameType: "test-counter",
  playerCount: 3,
  createInitialState: () => ({ stateVersion: 0, score: 0, winner: null }),
  isState: (state): state is CounterState =>
    "score" in state && "winner" in state,
  parseAction: (input) =>
    input &&
    typeof input === "object" &&
    "type" in input &&
    input.type === "ADD_POINT"
      ? { type: "ADD_POINT" }
      : null,
  applyAction(state, actor) {
    if (state.winner !== null) return { ok: false, reason: "GAME_FINISHED" };
    return {
      ok: true,
      nextState: {
        stateVersion: state.stateVersion + 1,
        score: state.score + 1,
        winner: state.score === 2 ? actor.seat : null,
      },
    };
  },
  getResult: (state) =>
    state.winner === null
      ? null
      : {
          kind: "win",
          winnerSeats: [state.winner],
          reason: "target-score",
          moveCount: null,
        },
};
const registry = () => new GameRegistry([omok, adaptGame(counter)], "omok");
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});

describe("static game registry and platform boundary", () => {
  it("rejects unknown games and duplicate registrations, and keeps the test game out of production", () => {
    expect(() => new GameRegistry([omok, omok], "omok")).toThrow("Duplicate");
    expect(() => new GameRegistry([omok], "missing")).toThrow("Default");
    expect(() =>
      new RoomStore().create("Title", "Host", undefined, "chess"),
    ).toThrow("UNKNOWN_GAME");
    expect(gameRegistry.list()).toEqual([{ gameType: "omok", playerCount: 2 }]);
  });
  it("adapts seat-to-color and validates untrusted actions without changing the Omok engine", () => {
    const initial = omok.createInitialState();
    expect(omok.applyAction(initial, { seat: 2 }, { type: "RESIGN" })).toEqual({
      ok: false,
      reason: "NOT_A_PLAYER",
    });
    for (const action of [
      null,
      [],
      { type: "ADD_POINT" },
      { type: "PLACE_STONE" },
    ])
      expect(omok.applyAction(initial, { seat: 0 }, action)).toEqual({
        ok: false,
        reason: "INVALID_REQUEST",
      });
    expect(omok.applyAction(initial, { seat: 1 }, { type: "RESIGN" })).toEqual({
      ok: false,
      reason: "WRONG_TURN",
    });
    expect(
      omok.applyAction(
        initial,
        { seat: 0 },
        { type: "PLACE_STONE", x: 0.5, y: 0 },
      ),
    ).toEqual({ ok: false, reason: "INVALID_COORDINATE" });
    const result = omok.applyAction(initial, { seat: 0 }, { type: "RESIGN" });
    if (!result.ok) throw new Error(result.reason);
    expect(omok.getResult(result.nextState)).toEqual({
      kind: "win",
      winnerSeats: [1],
      reason: "resignation",
      moveCount: 0,
    });
    expect(omok.getResult(initial)).toBeNull();
    expect(
      omok.applyAction(
        counter.createInitialState(),
        { seat: 0 },
        { type: "RESIGN" },
      ).ok,
    ).toBe(false);
    expect(
      omokDefinition.getResult({
        ...omokDefinition.createInitialState(),
        result: { kind: "draw" },
      }),
    ).toEqual({ kind: "draw", winnerSeats: [], reason: "draw", moveCount: 0 });
  });
  it("uses adapter capacity, fills vacant seats and allows repeated actions by the same seat", () => {
    const store = new RoomStore(registry());
    const host = store.create("Counter", "A", undefined, counter.gameType),
      id = host.room.id;
    const other = store.create("Other", "D", undefined, counter.gameType);
    const guest = store.join(id, "B"),
      third = store.join(id, "C");
    expect(store.get(id).capacity).toBe(3);
    store.leave(id, guest.token);
    expect(store.get(id).players.map((player) => player.seat)).toEqual([0, 2]);
    expect(() => store.start(id, host.token)).toThrow("NOT_READY");
    const replacement = store.join(id, "E");
    expect(store.get(id).players.map((player) => player.seat)).toEqual([
      0, 2, 1,
    ]);
    expect(() => store.join(id, "Extra")).toThrow("ROOM_FULL");
    for (const token of [host.token, third.token, replacement.token])
      store.ready(id, token);
    store.start(id, host.token);
    const match = store.get(id).matchId;
    expect(() =>
      store.action(
        id,
        third.token,
        { type: "PLACE_STONE", x: 0, y: 0 },
        0,
        match,
      ),
    ).toThrow("INVALID_REQUEST");
    expect(store.get(id).game.stateVersion).toBe(0);
    for (let version = 0; version < 3; version++)
      store.action(id, third.token, { type: "ADD_POINT" }, version, match);
    expect(store.get(id).result).toMatchObject({
      winnerSeats: [2],
      reason: "target-score",
    });
    expect(store.get(other.room.id).game).toEqual(counter.createInitialState());
    store.rematch(id, host.token);
    expect(store.get(id).game).toEqual(counter.createInitialState());
    expect(store.get(id).result).toBeNull();
    expect(store.get(id).matchId).not.toBe(match);
    expect(store.get(id).players.every((player) => !player.ready)).toBe(true);
  });
  it("routes non-Omok actions over WebSocket and stores three-player results atomically", async () => {
    const db = await openDatabase();
    cleanup.push(() => db.close());
    const store = new RoomStore(registry());
    const app = await buildApp(store);
    cleanup.push(() => app.close());
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries())
      await db.query(
        "INSERT INTO users(id,email,display_name,password_hash) VALUES ($1,$2,$3,'unused')",
        [id, `${id}@example.com`, `P${index}`],
      );
    const created = await app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { title: "Counter", hostName: "A", gameType: counter.gameType },
    });
    expect(created.statusCode).toBe(201);
    const { room, token } = created.json();
    const b = store.join(room.id, "B"),
      c = store.join(room.id, "C");
    for (const t of [token, b.token, c.token]) store.ready(room.id, t);
    store.start(room.id, token);
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const socket = new WebSocket(
      address.replace("http:", "ws:") + `/api/rooms/${room.id}/ws`,
    );
    cleanup.push(async () => {
      socket.terminate();
    });
    const messages: { type: string; requestId?: string; room: RoomSnapshot }[] =
      [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await expect
      .poll(() => messages.some((m) => m.type === "snapshot"))
      .toBe(true);
    for (let version = 0; version < 3; version++) {
      socket.send(
        JSON.stringify({
          type: "action",
          token: c.token,
          requestId: String(version),
          action: { type: "ADD_POINT" },
          expectedVersion: version,
          matchId: room.matchId,
        }),
      );
      await expect
        .poll(() =>
          messages.some(
            (m) => m.type === "ack" && m.requestId === String(version),
          ),
        )
        .toBe(true);
    }
    const result = store.get(room.id);
    expect(result.status).toBe("finished");
    expect(result.game).toHaveProperty("score", 3);
    const persisted: RoomSnapshot = {
      ...result,
      players: result.players.map((p, i) => ({ ...p, id: ids[i] })),
    };
    await saveResult(db, persisted);
    await saveResult(db, persisted);
    expect((await history(db, ids[2])).matches[0]).toMatchObject({
      gameType: counter.gameType,
      opponent: "A, B",
      outcome: "win",
      reason: "target-score",
      moveCount: null,
    });
    expect((await history(db, ids[0])).summary.losses).toBe(1);
    const invalid = {
      ...persisted,
      matchId: randomUUID(),
      players: persisted.players.map((p, i) => ({
        ...p,
        id: i === 2 ? randomUUID() : p.id,
      })),
    };
    await expect(saveResult(db, invalid)).rejects.toThrow();
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM game_matches",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM game_match_players",
        )
      ).rows[0].n,
    ).toBe(3);
    const unknown = await app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { title: "Unknown", hostName: "A", gameType: "not-registered" },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toBe("UNKNOWN_GAME");
  }, 30000);
});
