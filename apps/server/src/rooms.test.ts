import { describe, expect, it } from "vitest";
import { RoomStore } from "./rooms";

describe("server-owned online rooms", () => {
  it("enforces membership, seat, turn, version and occupied cells", () => {
    const store = new RoomStore();
    const host = store.create("Friendly game", "Host");
    const id = host.room.id;
    expect(() => store.join(id, "host")).toThrowError("DUPLICATE_NAME");
    const guest = store.join(id, "Guest");
    expect(() => store.join(id, "Third")).toThrowError("ROOM_FULL");
    expect(() => store.ready(id, "stranger")).toThrowError("NOT_A_PLAYER");
    expect(() => store.start(id, guest.token)).toThrowError("HOST_ONLY");
    store.ready(id, host.token);
    expect(() => store.start(id, host.token)).toThrowError("NOT_READY");
    store.ready(id, guest.token);
    store.start(id, host.token);
    expect(() =>
      store.action(
        id,
        guest.token,
        { type: "PLACE_STONE", x: 7, y: 7 },
        0,
        store.get(id).matchId,
      ),
    ).toThrowError("WRONG_TURN");
    store.action(
      id,
      host.token,
      { type: "PLACE_STONE", x: 7, y: 7 },
      0,
      store.get(id).matchId,
    );
    expect(() =>
      store.action(
        id,
        host.token,
        { type: "PLACE_STONE", x: 8, y: 7 },
        0,
        store.get(id).matchId,
      ),
    ).toThrowError("STALE_STATE");
    expect(() =>
      store.action(
        id,
        guest.token,
        { type: "PLACE_STONE", x: 7, y: 7 },
        1,
        store.get(id).matchId,
      ),
    ).toThrowError("OCCUPIED");
    expect(store.get(id).game.moves).toHaveLength(1);
    expect(store.get(id).game.currentTurn).toBe("white");
  });

  it("keeps games independent and requires host for rematch and close", () => {
    const store = new RoomStore();
    const first = store.create("One", "A"),
      second = store.create("Two", "C");
    const guest = store.join(first.room.id, "B");
    store.ready(first.room.id, first.token);
    store.ready(first.room.id, guest.token);
    store.start(first.room.id, first.token);
    store.action(
      first.room.id,
      first.token,
      { type: "RESIGN" },
      0,
      store.get(first.room.id).matchId,
    );
    expect(store.get(first.room.id).status).toBe("finished");
    expect(store.get(second.room.id).status).toBe("waiting");
    expect(() => store.rematch(first.room.id, guest.token)).toThrowError(
      "HOST_ONLY",
    );
    store.rematch(first.room.id, first.token);
    expect(store.get(first.room.id).game.moves).toHaveLength(0);
    expect(
      store.get(first.room.id).players.every((player) => !player.ready),
    ).toBe(true);
    expect(() => store.close(first.room.id, guest.token)).toThrowError(
      "HOST_ONLY",
    );
    store.close(first.room.id, first.token);
    expect(() => store.get(first.room.id)).toThrowError("ROOM_NOT_FOUND");
  });

  it("notifies subscribers after changes and revokes a departed guest", () => {
    const store = new RoomStore(),
      changed: string[] = [];
    const unsubscribe = store.subscribe((id) => changed.push(id));
    const host = store.create("One", "A"),
      guest = store.join(host.room.id, "B");
    store.leave(host.room.id, guest.token);
    expect(() => store.ready(host.room.id, guest.token)).toThrowError(
      "NOT_A_PLAYER",
    );
    expect(changed).toEqual([host.room.id, host.room.id, host.room.id]);
    unsubscribe();
    store.close(host.room.id, host.token);
    expect(changed).toHaveLength(3);
  });
});
