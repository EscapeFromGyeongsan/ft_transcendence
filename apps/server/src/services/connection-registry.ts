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

// Authenticated WebSocket connections by server session, so revoking a
// session (logout) can close every socket opened with its tokens, and by
// match, so a match's messages reach only the sockets subscribed to it.
export function createConnectionRegistry() {
  const bySession = new Map<string, Set<WebSocket>>();
  const byMatch = new Map<number, Set<WebSocket>>();
  const matchesOf = new Map<WebSocket, Set<number>>();

  function unsubscribe(matchId: number, socket: WebSocket) {
    deleteFrom(byMatch, matchId, socket);
    deleteFrom(matchesOf, socket, matchId);
  }

  return {
    add(sessionId: string, socket: WebSocket) {
      addTo(bySession, sessionId, socket);
    },

    // Called when the socket closes: drops it from every match as well.
    remove(sessionId: string, socket: WebSocket) {
      deleteFrom(bySession, sessionId, socket);
      for (const matchId of matchesOf.get(socket) ?? []) {
        unsubscribe(matchId, socket);
      }
    },

    closeSession(sessionId: string, code: number, reason: string) {
      const sockets = bySession.get(sessionId);
      bySession.delete(sessionId);
      for (const socket of sockets ?? []) socket.close(code, reason);
    },

    subscribe(matchId: number, socket: WebSocket) {
      addTo(byMatch, matchId, socket);
      addTo(matchesOf, socket, matchId);
    },

    unsubscribe,

    isSubscribed(matchId: number, socket: WebSocket) {
      return byMatch.get(matchId)?.has(socket) ?? false;
    },

    // Sends one serialized message to every socket subscribed to the match.
    broadcast(matchId: number, message: object) {
      const data = JSON.stringify(message);
      for (const socket of byMatch.get(matchId) ?? []) socket.send(data);
    },
  };
}

export type ConnectionRegistry = ReturnType<typeof createConnectionRegistry>;
