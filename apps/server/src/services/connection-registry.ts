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
    if (!byMatch.has(matchId)) sentVersions.delete(matchId);
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

    // Subscribes the socket and makes it the user's control connection for
    // the match. Returns the previous control socket, if it was another one.
    subscribe(matchId: number, userId: number, socket: WebSocket) {
      addTo(byMatch, matchId, socket);
      addTo(matchesOf, socket, matchId);
      const byUser = controllers.get(matchId) ?? new Map<number, WebSocket>();
      const previous = byUser.get(userId);
      byUser.set(userId, socket);
      controllers.set(matchId, byUser);
      return previous === socket ? undefined : previous;
    },

    unsubscribe,

    isSubscribed(matchId: number, socket: WebSocket) {
      return byMatch.get(matchId)?.has(socket) ?? false;
    },

    isController(matchId: number, userId: number, socket: WebSocket) {
      return controllers.get(matchId)?.get(userId) === socket;
    },

    // Sends one serialized message to every socket subscribed to the match,
    // unless a state at least this new was already sent. Returns whether it
    // was sent.
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
  };
}

export type ConnectionRegistry = ReturnType<typeof createConnectionRegistry>;
