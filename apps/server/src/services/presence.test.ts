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

  test("a friendship change reaches both users once", () => {
    const { presence, sent } = setup(async () => []);
    presence.notifyFriendsChanged(1, 2);
    expect(sent).toEqual([
      { to: 1, message: { type: "friends.changed", payload: {} } },
      { to: 2, message: { type: "friends.changed", payload: {} } },
    ]);
  });
});
