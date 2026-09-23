import { errorMessages, type OnlineRoom } from "./api";

/** Never replays commands: a lost acknowledgement may mean a command already ran. */
export function connectRoom(
  id: string,
  callbacks: {
    snapshot: (room: OnlineRoom) => void;
    connected: (value: boolean) => void;
    closed: () => void;
  },
) {
  let socket: WebSocket;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  const pending = new Map<
    string,
    {
      resolve: (room: OnlineRoom) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const rejectPending = () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(
        new Error("연결이 끊겼어요. 재연결 후 대국 상태를 확인해 주세요."),
      );
    }
    pending.clear();
  };
  const open = () => {
    const url = new URL(`/api/rooms/${id}/ws`, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onmessage = (event) => {
      if (stopped) return;
      const data = JSON.parse(event.data);
      if (data.type === "snapshot" || data.type === "ack") {
        callbacks.snapshot(data.room);
        callbacks.connected(true);
        attempt = 0;
      }
      if (data.type === "closed") {
        stopped = true;
        callbacks.connected(false);
        callbacks.closed();
        rejectPending();
        socket.close();
      }
      const item = pending.get(data.requestId);
      if (item) {
        clearTimeout(item.timer);
        pending.delete(data.requestId);
        if (data.type === "error")
          item.reject(
            new Error(errorMessages[data.error] ?? "요청을 처리하지 못했어요."),
          );
        else item.resolve(data.room);
      }
    };
    socket.onclose = () => {
      callbacks.connected(false);
      rejectPending();
      if (!stopped)
        retry = setTimeout(open, Math.min(500 * 2 ** attempt++, 5000));
    };
    socket.onerror = () => socket.close();
  };
  open();
  return {
    command(type: string, token: string, data?: unknown): Promise<OnlineRoom> {
      if (stopped || socket.readyState !== WebSocket.OPEN)
        return Promise.reject(new Error("서버 연결을 기다려 주세요."));
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(
            new Error(
              "응답을 기다리는 시간이 초과됐어요. 대국 상태를 확인해 주세요.",
            ),
          );
          socket.close();
        }, 10000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(
          JSON.stringify({ ...(data as object), type, token, requestId }),
        );
      });
    },
    dispose() {
      stopped = true;
      clearTimeout(retry);
      socket.onclose = null;
      socket.onmessage = null;
      rejectPending();
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.onopen = () => socket.close();
      } else {
        socket.close();
      }
    },
  };
}
