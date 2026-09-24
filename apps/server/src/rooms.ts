import { randomUUID } from "node:crypto";
import {
  applyAction,
  createInitialState,
  type OmokAction,
  type OmokState,
} from "@cafe/omok";

export type Player = { id: string; name: string; seat: number; ready: boolean };
export type RoomSnapshot = {
  id: string;
  revision: number;
  matchId: string;
  startedAt: string | null;
  finishedAt: string | null;
  title: string;
  gameType: "omok";
  capacity: 2;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  game: OmokState;
};
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
  create(titleValue: unknown, nameValue: unknown, accountId?: string) {
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
      gameType: "omok",
      capacity: 2,
      status: "waiting",
      players: [{ id: playerId, name, seat: 0, ready: false }],
      game: createInitialState(),
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
    if (room.snapshot.status !== "waiting" || room.snapshot.players.length >= 2)
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
    room.snapshot = {
      ...room.snapshot,
      players: [
        room.snapshot.players[0],
        { id: playerId, name, seat: 1, ready: false },
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
      room.snapshot.players.length !== 2 ||
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
    action: OmokAction,
    expectedVersion: unknown,
    matchId: unknown,
  ) {
    const room = this.room(id),
      actor = this.player(room, token);
    if (room.snapshot.status !== "playing") fail(409, "NOT_PLAYING");
    if (matchId !== room.snapshot.matchId) fail(409, "STALE_MATCH");
    if (expectedVersion !== room.snapshot.game.stateVersion)
      fail(409, "STALE_STATE");
    const result = applyAction(
      room.snapshot.game,
      actor.seat === 0 ? "black" : "white",
      action,
    );
    if (!result.ok) throw new RoomError(409, result.reason);
    const nextState = result.nextState;
    return {
      ...room.snapshot,
      game: nextState,
      status: nextState.result ? ("finished" as const) : ("playing" as const),
      finishedAt: nextState.result ? new Date().toISOString() : null,
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
    action: OmokAction,
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
      game: createInitialState(),
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
    if (room.snapshot.status !== "waiting" || actor.seat !== 1)
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
