import { describe, expect, test, vi } from "vitest";
import { createPresence } from "./presence.ts";

function setup(friendIdsOf: (userId: number) => Promise<number[]>) {
  const online = new Set<number>();
  const sent: { to: number; message: object }[] = [];
  const onError = vi.fn();
  const presence = createPresence({
    connections: {
      isUserOnline: (userId) => online.has(userId),
      sendToUser: (to, message) => sent.push({ to, message }),
    },
    friendIdsOf,
    onError,
  });
  return { presence, online, sent, onError };
}

describe("presence", () => {
  test("friends get the user's state at the time of sending", async () => {
    let release!: () => void;
    const { presence, online, sent } = setup(
      () => new Promise((resolve) => (release = () => resolve([2, 3]))),
    );
    online.add(1);
    const notified = presence.notifyPresence(1);
    // The user left again while the friend list was being read.
    online.delete(1);
    release();
    await notified;

    expect(sent).toEqual([
      {
        to: 2,
        message: { type: "presence", payload: { userId: 1, online: false } },
      },
      {
        to: 3,
        message: { type: "presence", payload: { userId: 1, online: false } },
      },
    ]);
  });

  test("a failed friend lookup is logged and sends nothing", async () => {
    const error = new Error("db down");
    const { presence, sent, onError } = setup(() => Promise.reject(error));
    await presence.notifyPresence(1);
    expect(sent).toEqual([]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  test("no presence reaches a former friend after friends.changed", async () => {
    // The friend table as the DB sees it. The first lookup reads it, then
    // its result is held back while the friendship is deleted.
    const friends = new Map([[1, [2]]]);
    let release!: () => void;
    const friendIdsOf = vi.fn(async (userId: number) => {
      const ids = friends.get(userId) ?? [];
      if (friendIdsOf.mock.calls.length === 1) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return ids;
    });
    const { presence, online, sent } = setup(friendIdsOf);
    online.add(1);
    const notified = presence.notifyPresence(1);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    friends.set(1, []);
    presence.notifyFriendsChanged(1, 2);
    release();
    await notified;

    expect(friendIdsOf).toHaveBeenCalledTimes(2);
    expect(sent.map(({ to, message }) => [to, message])).toEqual([
      [1, { type: "friends.changed", payload: {} }],
      [2, { type: "friends.changed", payload: {} }],
    ]);
  });

  test("a change between other users does not repeat the lookup", async () => {
    let release!: () => void;
    const friendIdsOf = vi.fn(
      () => new Promise<number[]>((resolve) => (release = () => resolve([2]))),
    );
    const { presence, online, sent } = setup(friendIdsOf);
    online.add(1);
    const notified = presence.notifyPresence(1);
    presence.notifyFriendsChanged(3, 4);
    release();
    await notified;

    expect(friendIdsOf).toHaveBeenCalledOnce();
    expect(sent.at(-1)).toEqual({
      to: 2,
      message: { type: "presence", payload: { userId: 1, online: true } },
    });
  });

  test("gives up after five lookups that keep changing", async () => {
    const { presence, online, sent } = setup(async () => {
      // Every lookup overlaps another change of user 1's friendships.
      presence.notifyFriendsChanged(1, 9);
      return [2];
    });
    online.add(1);
    sent.length = 0;
    await presence.notifyPresence(1);
    expect(
      sent.filter(
        ({ message }) => "type" in message && message.type === "presence",
      ),
    ).toEqual([]);
  });

  test("a friendship change reaches both users once", () => {
    const { presence, sent } = setup(async () => []);
    presence.notifyFriendsChanged(1, 2);
    expect(sent).toEqual([
      { to: 1, message: { type: "friends.changed", payload: {} } },
      { to: 2, message: { type: "friends.changed", payload: {} } },
    ]);
  });
});
