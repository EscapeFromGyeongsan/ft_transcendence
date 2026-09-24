import { randomUUID } from "node:crypto";
import type { Player, RoomSnapshot } from "@cafe/game-contracts";
import { gameRegistry, type GameRegistry } from "./games/registry.ts";
export type { Player, RoomSnapshot } from "@cafe/game-contracts";

type StoredRoom = { snapshot: RoomSnapshot; tokens: Map<string, string> };
export class RoomError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status: number, code: string): never => {
  throw new RoomError(status, code);
};
const clean = (value: unknown, max: number): string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.trim().length <= max
    ? value.trim()
    : fail(400, "INVALID_NAME");

/** In-memory, single-process authority. All mutations finish before notifying subscribers. */
export class RoomStore {
  readonly registry: GameRegistry;
  constructor(registry: GameRegistry = gameRegistry) {
    this.registry = registry;
  }
  private definition(gameType: string) {
    return this.registry.get(gameType) ?? fail(400, "UNKNOWN_GAME");
  }
  private rooms = new Map<string, StoredRoom>();
  private listeners = new Set<(id: string) => void>();
  subscribe(listener: (id: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(id: string) {
    const room = this.rooms.get(id);
    if (room)
      room.snapshot = {
        ...room.snapshot,
        revision: room.snapshot.revision + 1,
      };
    for (const listener of this.listeners) listener(id);
  }
  list(): RoomSnapshot[] {
    return [...this.rooms.values()].map(({ snapshot }) => snapshot);
  }
  get(id: string): RoomSnapshot {
    return this.room(id).snapshot;
  }
  private room(id: string): StoredRoom {
    return this.rooms.get(id) ?? fail(404, "ROOM_NOT_FOUND");
  }
  private player(room: StoredRoom, token: string): Player {
    const id = room.tokens.get(token);
    return (
      room.snapshot.players.find((player) => player.id === id) ??
      fail(403, "NOT_A_PLAYER")
    );
  }
  identity(id: string, token: string) {
    return this.player(this.room(id), token).id;
  }
  create(
    titleValue: unknown,
    nameValue: unknown,
    accountId?: string,
    gameType = this.registry.defaultGameType,
  ) {
    const definition = this.definition(gameType);
    const title = clean(titleValue, 40),
      name = clean(nameValue, 16);
    const id = randomUUID(),
      token = randomUUID(),
      playerId = accountId ?? randomUUID();
    const snapshot: RoomSnapshot = {
      id,
      revision: 0,
      matchId: randomUUID(),
      title,
      startedAt: null,
      finishedAt: null,
      gameType: definition.gameType,
      capacity: definition.playerCount,
      status: "waiting",
      players: [{ id: playerId, name, seat: 0, ready: false }],
      game: definition.createInitialState(),
      result: null,
    };
    this.rooms.set(id, {
      snapshot,
      tokens: new Map([[accountId ?? token, playerId]]),
    });
    this.changed(id);
    return { room: this.get(id), token, playerId };
  }
  join(id: string, nameValue: unknown, accountId?: string) {
    const name = clean(nameValue, 16),
      room = this.room(id);
    if (
      accountId &&
      room.snapshot.players.some((player) => player.id === accountId)
    )
      return { room: room.snapshot, playerId: accountId, token: accountId };
    if (
      room.snapshot.status !== "waiting" ||
      room.snapshot.players.length >= room.snapshot.capacity
    )
      fail(409, "ROOM_FULL");
    if (
      !accountId &&
      room.snapshot.players.some(
        (player) =>
          player.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      fail(409, "DUPLICATE_NAME");
    const token = randomUUID(),
      playerId = accountId ?? randomUUID();
    const seat = Array.from(
      { length: room.snapshot.capacity },
      (_, index) => index,
    ).find(
      (index) => !room.snapshot.players.some((player) => player.seat === index),
    )!;
    room.snapshot = {
      ...room.snapshot,
      players: [
        ...room.snapshot.players,
        { id: playerId, name, seat, ready: false },
      ],
    };
    room.tokens.set(accountId ?? token, playerId);
    this.changed(id);
    return { room: room.snapshot, token, playerId };
  }
  ready(id: string, token: string) {
    const room = this.room(id),
      actor = this.player(room, token);
    if (room.snapshot.status !== "waiting") fail(409, "NOT_WAITING");
    room.snapshot = {
      ...room.snapshot,
      players: room.snapshot.players.map((player) =>
        player.id === actor.id ? { ...player, ready: !player.ready } : player,
      ),
    };
    this.changed(id);
    return room.snapshot;
  }
  start(id: string, token: string) {
    const room = this.room(id),
      actor = this.player(room, token);
    if (actor.seat !== 0) fail(403, "HOST_ONLY");
    if (
      room.snapshot.status !== "waiting" ||
      room.snapshot.players.length !== room.snapshot.capacity ||
      !room.snapshot.players.every((player) => player.ready)
    )
      fail(409, "NOT_READY");
    room.snapshot = {
      ...room.snapshot,
      status: "playing",
      startedAt: new Date().toISOString(),
    };
    this.changed(id);
    return room.snapshot;
  }
  previewAction(
    id: string,
    token: string,
    action: unknown,
    expectedVersion: unknown,
    matchId: unknown,
  ) {
    const room = this.room(id),
      actor = this.player(room, token);
    if (room.snapshot.status !== "playing") fail(409, "NOT_PLAYING");
    if (matchId !== room.snapshot.matchId) fail(409, "STALE_MATCH");
    if (expectedVersion !== room.snapshot.game.stateVersion)
      fail(409, "STALE_STATE");
    const definition = this.definition(room.snapshot.gameType);
    const result = definition.applyAction(
      room.snapshot.game,
      { seat: actor.seat },
      action,
    );
    if (!result.ok) throw new RoomError(409, result.reason);
    const nextState = result.nextState;
    const outcome = definition.getResult(nextState);
    return {
      ...room.snapshot,
      game: nextState,
      result: outcome,
      status: outcome ? ("finished" as const) : ("playing" as const),
      finishedAt: outcome ? new Date().toISOString() : null,
    };
  }
  commitAction(id: string, next: RoomSnapshot) {
    this.room(id).snapshot = next;
    this.changed(id);
    return this.get(id);
  }
  action(
    id: string,
    token: string,
    action: unknown,
    expectedVersion: unknown,
    matchId: unknown,
  ) {
    return this.commitAction(
      id,
      this.previewAction(id, token, action, expectedVersion, matchId),
    );
  }
  rematch(id: string, token: string) {
    const room = this.room(id),
      actor = this.player(room, token);
    if (actor.seat !== 0) fail(403, "HOST_ONLY");
    if (room.snapshot.status !== "finished") fail(409, "NOT_FINISHED");
    room.snapshot = {
      ...room.snapshot,
      status: "waiting",
      startedAt: null,
      finishedAt: null,
      matchId: randomUUID(),
      game: this.definition(room.snapshot.gameType).createInitialState(),
      result: null,
      players: room.snapshot.players.map((player) => ({
        ...player,
        ready: false,
      })),
    };
    this.changed(id);
    return room.snapshot;
  }
  leave(id: string, token: string) {
    const room = this.room(id),
      actor = this.player(room, token);
    if (room.snapshot.status !== "waiting" || actor.seat === 0)
      fail(409, "CANNOT_LEAVE");
    room.snapshot = {
      ...room.snapshot,
      players: room.snapshot.players
        .filter((player) => player.id !== actor.id)
        .map((player) => ({ ...player, ready: false })),
    };
    room.tokens.delete(token);
    this.changed(id);
    return room.snapshot;
  }
  close(id: string, token: string) {
    const room = this.room(id);
    if (this.player(room, token).seat !== 0) fail(403, "HOST_ONLY");
    if (room.snapshot.status === "playing") fail(409, "CANNOT_CLOSE_PLAYING");
    this.rooms.delete(id);
    this.changed(id);
  }
}
