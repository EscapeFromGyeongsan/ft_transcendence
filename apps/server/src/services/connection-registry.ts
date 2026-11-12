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
 * 경기·사용자별 입력 권한 연결과 경기별 마지막 전송 버전도 함께 관리합니다.
 * 메모리에만 있으며 API 인스턴스 1개를 전제합니다.
 */
export function createConnectionRegistry() {
  const bySession = new Map<string, Set<WebSocket>>();
  const byUser = new Map<number, Set<WebSocket>>();
  const userOf = new Map<WebSocket, number>();
  const byMatch = new Map<number, Set<WebSocket>>();
  const matchesOf = new Map<WebSocket, Set<number>>();
  // FR-MATCH-02: per match and user, only the socket that subscribed last
  // may send commands (other tabs or devices keep watching).
  const controllers = new Map<number, Map<number, WebSocket>>();
  // Highest stateVersion broadcast per match, so updates never go backwards.
  const sentVersions = new Map<number, number>();

  function unsubscribe(matchId: number, socket: WebSocket) {
    deleteFrom(byMatch, matchId, socket);
    deleteFrom(matchesOf, socket, matchId);
    const byUser = controllers.get(matchId);
    for (const [userId, controller] of byUser ?? []) {
      if (controller === socket) byUser!.delete(userId);
    }
    if (byUser?.size === 0) controllers.delete(matchId);
  }

  return {
    /**
     * 인증에 성공한 연결을 세션과 사용자에 등록합니다.
     *
     * @param userId - 연결의 사용자. `sendToUser()`가 이 사용자의 모든 연결을
     *   찾을 때 씁니다.
     */
    add(sessionId: string, socket: WebSocket, userId: number) {
      addTo(bySession, sessionId, socket);
      addTo(byUser, userId, socket);
      userOf.set(socket, userId);
    },

    /**
     * 닫힌 연결을 목록에서 뺍니다. 연결의 `close` 이벤트에서 호출하며,
     * 그 연결의 경기 구독과 입력 권한도 모두 해제합니다.
     *
     * @returns 이 연결이 구독하고 있던 경기 ID 목록
     */
    remove(sessionId: string, socket: WebSocket) {
      deleteFrom(bySession, sessionId, socket);
      const userId = userOf.get(socket);
      if (userId !== undefined) deleteFrom(byUser, userId, socket);
      userOf.delete(socket);
      const matchIds = [...(matchesOf.get(socket) ?? [])];
      for (const matchId of matchIds) unsubscribe(matchId, socket);
      return matchIds;
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
     * 연결을 경기 구독자로 등록하고, 그 사용자의 입력 권한 연결로 정합니다.
     *
     * @returns 입력 권한을 잃은 이전 연결. 없거나 같은 연결이면 `undefined`
     *
     * @remarks
     * FR-MATCH-02: 경기·사용자마다 마지막으로 구독한 연결 하나만 명령을 보낼 수
     * 있습니다. 이전 연결은 구독을 유지해 갱신은 계속 받습니다. 참가자 확인은
     * 호출하는 쪽에서 먼저 합니다.
     */
    subscribe(matchId: number, userId: number, socket: WebSocket) {
      addTo(byMatch, matchId, socket);
      addTo(matchesOf, socket, matchId);
      const byUser = controllers.get(matchId) ?? new Map<number, WebSocket>();
      const previous = byUser.get(userId);
      byUser.set(userId, socket);
      controllers.set(matchId, byUser);
      return previous === socket ? undefined : previous;
    },

    /** 경기 구독과 그 연결의 입력 권한을 해제합니다. 구독하지 않은 연결이면 변화가 없습니다. */
    unsubscribe,

    isSubscribed(matchId: number, socket: WebSocket) {
      return byMatch.get(matchId)?.has(socket) ?? false;
    },

    /** 경기를 구독한 연결이 하나라도 있는지 확인합니다. */
    hasSubscribers(matchId: number) {
      return byMatch.has(matchId);
    },

    /** 이 연결이 해당 사용자의 경기 입력 권한 연결인지 확인합니다. */
    isController(matchId: number, userId: number, socket: WebSocket) {
      return controllers.get(matchId)?.get(userId) === socket;
    },

    /**
     * 경기 상태 갱신을 한 번만 직렬화해 경기 구독자 전체에 보냅니다.
     *
     * @param stateVersion - 메시지에 담긴 snapshot의 버전
     * @returns 보냈으면 `true`. 구독자가 없거나 같거나 높은 버전을 이미 보냈으면 `false`
     *
     * @remarks
     * `apply()` 결과가 돌아오는 순서는 commit 순서와 다를 수 있습니다. 경기마다
     * 마지막으로 보낸 버전을 기억해, 버전이 줄어드는 갱신을 보내지 않습니다
     * (SDS 12번). 다른 경기의 구독자에게는 보내지 않습니다.
     */
    broadcastUpdate(matchId: number, stateVersion: number, message: object) {
      const sockets = byMatch.get(matchId);
      if (!sockets || stateVersion <= (sentVersions.get(matchId) ?? -1)) {
        return false;
      }
      sentVersions.set(matchId, stateVersion);
      const data = JSON.stringify(message);
      for (const socket of sockets) socket.send(data);
      return true;
    },

    /** 사용자의 인증된 연결 전체(여러 탭·기기)에 메시지를 보냅니다. */
    sendToUser(userId: number, message: object) {
      const data = JSON.stringify(message);
      for (const socket of byUser.get(userId) ?? []) socket.send(data);
    },

    /**
     * 경기가 끝났을 때 그 경기의 마지막 전송 버전을 지웁니다.
     *
     * @remarks
     * 구독자가 모두 나가도 지우지 않습니다. 그 뒤 늦게 끝난 명령이 낮은 버전을
     * 새 구독자에게 보내지 않게 하기 위해서입니다.
     */
    forgetMatch(matchId: number) {
      sentVersions.delete(matchId);
    },
  };
}

export type ConnectionRegistry = ReturnType<typeof createConnectionRegistry>;
