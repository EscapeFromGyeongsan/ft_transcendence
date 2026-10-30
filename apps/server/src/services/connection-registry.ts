import type { WebSocket } from "ws";

// Authenticated WebSocket connections by server session, so revoking a
// session (logout) can close every socket opened with its tokens.
export function createConnectionRegistry() {
  const bySession = new Map<string, Set<WebSocket>>();
  return {
    add(sessionId: string, socket: WebSocket) {
      const sockets = bySession.get(sessionId) ?? new Set<WebSocket>();
      sockets.add(socket);
      bySession.set(sessionId, sockets);
    },

    remove(sessionId: string, socket: WebSocket) {
      const sockets = bySession.get(sessionId);
      sockets?.delete(socket);
      if (sockets?.size === 0) bySession.delete(sessionId);
    },

    closeSession(sessionId: string, code: number, reason: string) {
      const sockets = bySession.get(sessionId);
      bySession.delete(sessionId);
      for (const socket of sockets ?? []) socket.close(code, reason);
    },
  };
}

export type ConnectionRegistry = ReturnType<typeof createConnectionRegistry>;
