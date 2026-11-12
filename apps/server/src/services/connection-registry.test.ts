import { describe, expect, test, vi } from "vitest";
import type { WebSocket } from "ws";
import { createConnectionRegistry } from "./connection-registry.ts";

function fakeSocket() {
  return { send: vi.fn(), close: vi.fn() } as unknown as WebSocket & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

describe("connection registry", () => {
  test("a match broadcast reaches only that match's subscribers", () => {
    const registry = createConnectionRegistry();
    const [a1, a2, b1, idle] = [1, 2, 3, 4].map(fakeSocket);
    registry.add("s1", a1);
    registry.add("s2", a2);
    registry.add("s3", b1);
    registry.add("s4", idle);
    registry.subscribe(10, 1, a1);
    registry.subscribe(10, 2, a2);
    registry.subscribe(20, 3, b1);

    registry.broadcastUpdate(10, 1, { type: "game.updated" });

    const sent = JSON.stringify({ type: "game.updated" });
    expect(a1.send).toHaveBeenCalledExactlyOnceWith(sent);
    expect(a2.send).toHaveBeenCalledExactlyOnceWith(sent);
    expect(b1.send).not.toHaveBeenCalled();
    expect(idle.send).not.toHaveBeenCalled();
  });

  test("updates never go backwards within a match", () => {
    const registry = createConnectionRegistry();
    const socket = fakeSocket();
    registry.subscribe(10, 1, socket);

    expect(registry.broadcastUpdate(10, 2, { v: 2 })).toBe(true);
    expect(registry.broadcastUpdate(10, 1, { v: 1 })).toBe(false);
    expect(registry.broadcastUpdate(10, 2, { v: 2 })).toBe(false);
    expect(registry.broadcastUpdate(10, 3, { v: 3 })).toBe(true);
    expect(socket.send.mock.calls).toEqual([
      [JSON.stringify({ v: 2 })],
      [JSON.stringify({ v: 3 })],
    ]);
  });

  test("the sent version survives an empty match until forgetMatch", () => {
    const registry = createConnectionRegistry();
    const [first, later] = [1, 2].map(fakeSocket);
    registry.subscribe(10, 1, first);
    registry.broadcastUpdate(10, 3, { v: 3 });
    registry.unsubscribe(10, first);

    registry.subscribe(10, 1, later);
    expect(registry.broadcastUpdate(10, 2, { v: 2 })).toBe(false);
    registry.forgetMatch(10);
    expect(registry.broadcastUpdate(10, 2, { v: 2 })).toBe(true);
  });

  test("the last subscribing socket of a user controls the match", () => {
    const registry = createConnectionRegistry();
    const [tab1, tab2, opponent] = [1, 2, 3].map(fakeSocket);

    expect(registry.subscribe(10, 1, tab1)).toBeUndefined();
    expect(registry.subscribe(10, 2, opponent)).toBeUndefined();
    expect(registry.subscribe(10, 1, tab2)).toBe(tab1);
    expect(registry.subscribe(10, 1, tab2)).toBeUndefined();

    expect(registry.isController(10, 1, tab1)).toBe(false);
    expect(registry.isController(10, 1, tab2)).toBe(true);
    expect(registry.isController(10, 2, opponent)).toBe(true);
    // The replaced socket keeps watching.
    expect(registry.isSubscribed(10, tab1)).toBe(true);

    registry.unsubscribe(10, tab2);
    expect(registry.isController(10, 1, tab2)).toBe(false);
    expect(registry.isController(10, 2, opponent)).toBe(true);
  });

  test("unsubscribe and socket removal stop further messages", () => {
    const registry = createConnectionRegistry();
    const [left, closed, stays] = [1, 2, 3].map(fakeSocket);
    for (const [i, socket] of [left, closed, stays].entries()) {
      registry.add("s", socket);
      registry.subscribe(10, i + 1, socket);
    }
    registry.subscribe(20, 2, closed);

    registry.unsubscribe(10, left);
    expect(registry.remove("s", closed)).toEqual([10, 20]);
    registry.broadcastUpdate(10, 1, { type: "x" });
    registry.broadcastUpdate(20, 1, { type: "x" });

    expect(left.send).not.toHaveBeenCalled();
    expect(closed.send).not.toHaveBeenCalled();
    expect(stays.send).toHaveBeenCalledOnce();
    expect(registry.isSubscribed(10, left)).toBe(false);
    expect(registry.isSubscribed(20, closed)).toBe(false);
    expect(registry.isController(20, 2, closed)).toBe(false);
    expect(registry.hasSubscribers(10)).toBe(true);
    expect(registry.hasSubscribers(20)).toBe(false);
    expect(registry.isSubscribed(10, stays)).toBe(true);
  });

  test("closeSession closes only that session's sockets", () => {
    const registry = createConnectionRegistry();
    const [tab1, tab2, other] = [1, 2, 3].map(fakeSocket);
    registry.add("s1", tab1);
    registry.add("s1", tab2);
    registry.add("s2", other);

    registry.closeSession("s1", 4401, "Session ended.");

    expect(tab1.close).toHaveBeenCalledWith(4401, "Session ended.");
    expect(tab2.close).toHaveBeenCalledWith(4401, "Session ended.");
    expect(other.close).not.toHaveBeenCalled();
  });
});
