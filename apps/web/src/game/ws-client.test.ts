import { describe, expect, it, vi } from "vitest";
import {
  createGameWsClient,
  type GameWsClientHandlers,
  type MinimalWebSocket,
} from "./ws-client.ts";

function setup(handlers: GameWsClientHandlers) {
  const sockets: MinimalWebSocket[] = [];
  const client = createGameWsClient({
    getAccessToken: () => "access-token",
    heartbeatIntervalMs: 0,
    createWebSocket: () => {
      const socket: MinimalWebSocket = {
        readyState: 1,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(socket);
      return socket;
    },
    handlers,
  });
  client.connect();
  return { client, sockets };
}

function receive(socket: MinimalWebSocket, type: string, payload?: unknown) {
  socket.onmessage?.({ data: JSON.stringify({ type, payload }) });
}

function authenticate(socket: MinimalWebSocket) {
  socket.onopen?.({});
  receive(socket, "auth.ok", { userId: 1, activeMatchId: null });
}

describe("#136 재시도하지 않는 종료 코드", () => {
  it.each([4400, 1008, 1009])(
    "%s는 자동 재접속을 멈추고 수동 재접속은 허용한다",
    (code) => {
      vi.useFakeTimers();
      const { client, sockets } = setup({});
      try {
        authenticate(sockets[0]);
        sockets[0].onclose?.({ code });
        vi.advanceTimersByTime(60_000);
        expect(client.getPhase()).toBe("disconnected");
        expect(sockets).toHaveLength(1);
        client.reconnectNow();
        expect(sockets).toHaveLength(2);
      } finally {
        client.disconnect();
        vi.useRealTimers();
      }
    },
  );
});

describe("친구 목록을 무효화하는 WebSocket 알림", () => {
  it("인증 후 유효한 presence와 friends.changed를 전달한다", () => {
    const onPresence = vi.fn();
    const onFriendsChanged = vi.fn();
    const { client, sockets } = setup({ onPresence, onFriendsChanged });
    const socket = sockets[0];
    authenticate(socket);

    receive(socket, "presence", { userId: 7, online: true });
    receive(socket, "presence", { userId: 7, online: false });
    receive(socket, "friends.changed", {});
    receive(socket, "friends.changed", { ignored: true });

    expect(onPresence.mock.calls).toEqual([
      [{ userId: 7, online: true }],
      [{ userId: 7, online: false }],
    ]);
    expect(onFriendsChanged).toHaveBeenCalledTimes(2);
    expect(onFriendsChanged).toHaveBeenCalledWith();
    client.disconnect();
  });

  it("연결 중이거나 auth.ok를 받기 전에는 친구 알림을 전달하지 않는다", () => {
    const onPresence = vi.fn();
    const onFriendsChanged = vi.fn();
    const { client, sockets } = setup({ onPresence, onFriendsChanged });
    const socket = sockets[0];
    receive(socket, "presence", { userId: 7, online: true });
    receive(socket, "friends.changed", {});
    socket.onopen?.({});
    receive(socket, "presence", { userId: 7, online: true });
    receive(socket, "friends.changed", {});

    expect(onPresence).not.toHaveBeenCalled();
    expect(onFriendsChanged).not.toHaveBeenCalled();
    client.disconnect();
  });

  it("잘못된 사용자 ID·온라인 상태·객체가 아닌 payload를 무시한다", () => {
    const onPresence = vi.fn();
    const onFriendsChanged = vi.fn();
    const { client, sockets } = setup({ onPresence, onFriendsChanged });
    const socket = sockets[0];
    authenticate(socket);

    for (const payload of [
      undefined,
      null,
      [],
      "invalid",
      { userId: "7", online: true },
      { userId: 0, online: true },
      { userId: -1, online: true },
      { userId: 1.5, online: true },
      { userId: Number.MAX_SAFE_INTEGER + 1, online: true },
      { userId: 7 },
      { userId: 7, online: "true" },
      { userId: 7, online: null },
    ]) {
      receive(socket, "presence", payload);
    }
    for (const payload of [undefined, null, [], true, 1, "invalid"]) {
      receive(socket, "friends.changed", payload);
    }

    expect(onPresence).not.toHaveBeenCalled();
    expect(onFriendsChanged).not.toHaveBeenCalled();
    client.disconnect();
  });

  it("재연결·연결 종료 뒤 이전 소켓의 늦은 알림은 전달하지 않는다", () => {
    const onPresence = vi.fn();
    const onFriendsChanged = vi.fn();
    const { client, sockets } = setup({ onPresence, onFriendsChanged });
    const first = sockets[0];
    authenticate(first);
    const oldMessage = first.onmessage;
    client.reconnectNow();
    expect(first.onmessage).toBeNull();

    const current = sockets[1];
    authenticate(current);
    oldMessage?.({
      data: JSON.stringify({
        type: "presence",
        payload: { userId: 7, online: true },
      }),
    });
    oldMessage?.({
      data: JSON.stringify({ type: "friends.changed", payload: {} }),
    });
    expect(onPresence).not.toHaveBeenCalled();
    expect(onFriendsChanged).not.toHaveBeenCalled();

    receive(current, "presence", { userId: 8, online: false });
    receive(current, "friends.changed", {});
    expect(onPresence).toHaveBeenCalledExactlyOnceWith({
      userId: 8,
      online: false,
    });
    expect(onFriendsChanged).toHaveBeenCalledTimes(1);
    const lastMessage = current.onmessage;
    client.disconnect();
    expect(current.onmessage).toBeNull();
    lastMessage?.({
      data: JSON.stringify({
        type: "presence",
        payload: { userId: 8, online: true },
      }),
    });
    lastMessage?.({
      data: JSON.stringify({ type: "friends.changed", payload: {} }),
    });
    expect(onPresence).toHaveBeenCalledTimes(1);
    expect(onFriendsChanged).toHaveBeenCalledTimes(1);
  });
});

describe("수동 재접속", () => {
  it("자동 재시도를 다 쓴 뒤 reconnectNow는 재시도 횟수를 처음부터 다시 센다", () => {
    vi.useFakeTimers();
    try {
      const sockets: MinimalWebSocket[] = [];
      const phases: Array<[string, number]> = [];
      const client = createGameWsClient({
        getAccessToken: () => "access-token",
        heartbeatIntervalMs: 0,
        reconnectDelaysMs: [10],
        maxReconnectAttempts: 2,
        createWebSocket: () => {
          const socket: MinimalWebSocket = {
            readyState: 1,
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            send: vi.fn(),
            close: vi.fn(),
          };
          sockets.push(socket);
          return socket;
        },
        handlers: {
          onPhaseChange: (phase, attempt) => phases.push([phase, attempt]),
        },
      });
      client.connect();
      // 연결이 끊기면 2회 자동 재시도 후 포기합니다.
      for (let i = 0; i < 3; i++) {
        sockets.at(-1)?.onclose?.({ code: 1006, reason: "" });
        vi.advanceTimersByTime(10);
      }
      expect(sockets).toHaveLength(3);
      expect(client.getPhase()).toBe("disconnected");

      client.reconnectNow();
      expect(sockets).toHaveLength(4);
      // 수동 재접속 뒤 다시 끊겨도 자동 재시도가 2회 더 이어집니다.
      for (let i = 0; i < 2; i++) {
        sockets.at(-1)?.onclose?.({ code: 1006, reason: "" });
        vi.advanceTimersByTime(10);
      }
      expect(sockets).toHaveLength(6);
      expect(phases.at(-1)?.[0]).toBe("reconnecting");
      client.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
