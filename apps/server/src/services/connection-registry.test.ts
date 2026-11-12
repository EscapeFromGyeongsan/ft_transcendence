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
    registry.subscribe(10, a1);
    registry.subscribe(10, a2);
    registry.subscribe(20, b1);

    registry.broadcast(10, { type: "game.updated", payload: { matchId: 10 } });

    const sent = JSON.stringify({
      type: "game.updated",
      payload: { matchId: 10 },
    });
    expect(a1.send).toHaveBeenCalledExactlyOnceWith(sent);
    expect(a2.send).toHaveBeenCalledExactlyOnceWith(sent);
    expect(b1.send).not.toHaveBeenCalled();
    expect(idle.send).not.toHaveBeenCalled();
  });

  test("unsubscribe and socket removal stop further messages", () => {
    const registry = createConnectionRegistry();
    const [left, closed, stays] = [1, 2, 3].map(fakeSocket);
    for (const socket of [left, closed, stays]) {
      registry.add("s", socket);
      registry.subscribe(10, socket);
    }
    registry.subscribe(20, closed);

    registry.unsubscribe(10, left);
    registry.remove("s", closed);
    registry.broadcast(10, { type: "x" });
    registry.broadcast(20, { type: "x" });

    expect(left.send).not.toHaveBeenCalled();
    expect(closed.send).not.toHaveBeenCalled();
    expect(stays.send).toHaveBeenCalledOnce();
    expect(registry.isSubscribed(10, left)).toBe(false);
    expect(registry.isSubscribed(20, closed)).toBe(false);
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
