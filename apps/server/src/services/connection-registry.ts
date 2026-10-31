import type { WebSocket } from "ws";

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const values = map.get(key) ?? new Set<V>();
  values.add(value);
  map.set(key, values);
}

function deleteFrom<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const values = map.get(key);
  values?.delete(value);
  if (values?.size === 0) map.delete(key);
}

/**
 * 인증된 WebSocket 연결을 서버 세션별·경기별로 보관하는 목록을 만듭니다.
 *
 * @remarks
 * 세션별 목록은 세션이 폐기될 때(로그아웃) 그 세션의 연결을 모두 닫는 데,
 * 경기별 목록은 경기 메시지를 그 경기를 구독한 연결에만 보내는 데 씁니다.
 * 메모리에만 있으며 API 인스턴스 1개를 전제합니다.
 */
export function createConnectionRegistry() {
  const bySession = new Map<string, Set<WebSocket>>();
  const byMatch = new Map<number, Set<WebSocket>>();
  const matchesOf = new Map<WebSocket, Set<number>>();

  function unsubscribe(matchId: number, socket: WebSocket) {
    deleteFrom(byMatch, matchId, socket);
    deleteFrom(matchesOf, socket, matchId);
  }

  return {
    /** 인증에 성공한 연결을 세션에 등록합니다. */
    add(sessionId: string, socket: WebSocket) {
      addTo(bySession, sessionId, socket);
    },

    /**
     * 닫힌 연결을 목록에서 뺍니다. 연결의 `close` 이벤트에서 호출하며,
     * 그 연결의 경기 구독도 모두 해제합니다.
     */
    remove(sessionId: string, socket: WebSocket) {
      deleteFrom(bySession, sessionId, socket);
      for (const matchId of matchesOf.get(socket) ?? []) {
        unsubscribe(matchId, socket);
      }
    },

    /**
     * 세션의 연결을 모두 닫고 목록에서 지웁니다.
     *
     * @param code - WebSocket close code (로그아웃은 4401)
     */
    closeSession(sessionId: string, code: number, reason: string) {
      const sockets = bySession.get(sessionId);
      bySession.delete(sessionId);
      for (const socket of sockets ?? []) socket.close(code, reason);
    },

    /**
     * 연결을 경기 구독자로 등록합니다. 이미 구독 중이면 변화가 없습니다.
     *
     * @remarks 참가자 확인은 호출하는 쪽에서 먼저 합니다.
     */
    subscribe(matchId: number, socket: WebSocket) {
      addTo(byMatch, matchId, socket);
      addTo(matchesOf, socket, matchId);
    },

    /** 경기 구독을 해제합니다. 구독하지 않은 연결이면 변화가 없습니다. */
    unsubscribe,

    isSubscribed(matchId: number, socket: WebSocket) {
      return byMatch.get(matchId)?.has(socket) ?? false;
    },

    /**
     * 메시지를 한 번만 직렬화해 경기 구독자 전체에 보냅니다.
     *
     * @remarks 다른 경기의 구독자와 구독하지 않은 연결에는 보내지 않습니다.
     */
    broadcast(matchId: number, message: object) {
      const data = JSON.stringify(message);
      for (const socket of byMatch.get(matchId) ?? []) socket.send(data);
    },
  };
}

export type ConnectionRegistry = ReturnType<typeof createConnectionRegistry>;
