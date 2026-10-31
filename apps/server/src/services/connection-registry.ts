import type { WebSocket } from "ws";

/**
 * 인증된 WebSocket 연결을 서버 세션별로 보관하는 목록을 만듭니다.
 *
 * @remarks
 * 세션이 폐기되면(로그아웃) 그 세션의 토큰으로 연 연결을 모두 닫기 위해
 * 씁니다. 메모리에만 있으며 API 인스턴스 1개를 전제합니다.
 */
export function createConnectionRegistry() {
  const bySession = new Map<string, Set<WebSocket>>();
  return {
    /** 인증에 성공한 연결을 세션에 등록합니다. */
    add(sessionId: string, socket: WebSocket) {
      const sockets = bySession.get(sessionId) ?? new Set<WebSocket>();
      sockets.add(socket);
      bySession.set(sessionId, sockets);
    },

    /** 닫힌 연결을 목록에서 뺍니다. 연결의 `close` 이벤트에서 호출합니다. */
    remove(sessionId: string, socket: WebSocket) {
      const sockets = bySession.get(sessionId);
      sockets?.delete(socket);
      if (sockets?.size === 0) bySession.delete(sessionId);
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
  };
}

export type ConnectionRegistry = ReturnType<typeof createConnectionRegistry>;
