import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { AccessTokenClaims } from "../core/tokens.ts";
import type { AuthService } from "../services/auth-service.ts";
import type { ConnectionRegistry } from "../services/connection-registry.ts";
import type { GameCommandService } from "../services/game-command-service.ts";

// IF-03 draft (SDS 2.5의 9번): every message is one JSON envelope. The server
// echoes requestId on the reply to a client request.
export type Envelope = {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
};

export const closeCodes = {
  internalError: 1011,
  malformedMessage: 4400,
  unauthenticated: 4401,
} as const;

export type RealtimeConfig = {
  /** Time allowed for the first `auth` message (default 5 s). */
  authTimeoutMs?: number;
};

const MAX_REQUEST_ID_LENGTH = 64;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEnvelope(data: string): Envelope | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;
  const { type, requestId, payload } = value;
  if (typeof type !== "string" || !isObject(payload)) return null;
  if (
    requestId !== undefined &&
    (typeof requestId !== "string" ||
      requestId.length === 0 ||
      requestId.length > MAX_REQUEST_ID_LENGTH)
  ) {
    return null;
  }
  return { type, requestId, payload };
}

function send(
  socket: WebSocket,
  type: string,
  payload: object,
  requestId?: string,
) {
  socket.send(JSON.stringify({ type, requestId, payload }));
}

function sendError(
  socket: WebSocket,
  requestId: string | undefined,
  code: string,
  message: string,
  details: object = {},
) {
  send(socket, "error", { code, message, ...details }, requestId);
}

// Same bound as the REST API: BIGINT ids travel as safe JSON integers.
function isMatchId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function registerRealtimeRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getGames: () => GameCommandService,
  connections: ConnectionRegistry,
  config: RealtimeConfig = {},
) {
  const authTimeoutMs = config.authTimeoutMs ?? 5000;

  // Only participants may subscribe. The socket joins the match before the
  // snapshot is read, so an update committed in between is still delivered;
  // clients drop updates whose stateVersion is not newer than their snapshot.
  async function subscribe(
    socket: WebSocket,
    userId: number,
    { requestId, payload }: Envelope,
  ) {
    const { matchId } = payload;
    if (!isMatchId(matchId)) {
      sendError(socket, requestId, "INVALID_MESSAGE", "Invalid matchId.");
      return;
    }
    const games = getGames();
    const match = await games.getMatch(matchId);
    if (!match) {
      sendError(socket, requestId, "NOT_FOUND", "Match not found.", {
        matchId,
      });
      return;
    }
    if (!match.players.some((player) => player.userId === userId)) {
      sendError(
        socket,
        requestId,
        "NOT_PARTICIPANT",
        "Only players of this match can subscribe.",
        { matchId },
      );
      return;
    }
    // Closed while the match was read: the close handler already ran.
    if (socket.readyState !== socket.OPEN) return;
    connections.subscribe(matchId, socket);
    try {
      const snapshot = await games.getSnapshot(matchId);
      send(socket, "match.snapshot", snapshot!, requestId);
    } catch (error) {
      connections.unsubscribe(matchId, socket);
      throw error;
    }
  }

  function unsubscribe(socket: WebSocket, { requestId, payload }: Envelope) {
    const { matchId } = payload;
    if (!isMatchId(matchId)) {
      sendError(socket, requestId, "INVALID_MESSAGE", "Invalid matchId.");
      return;
    }
    connections.unsubscribe(matchId, socket);
    send(socket, "match.unsubscribed", { matchId }, requestId);
  }

  // The access token arrives in the first message, never in the URL, so it
  // does not end up in proxy or access logs.
  app.get(
    "/api/ws",
    { websocket: true, schema: { hide: true } },
    (socket, request) => {
      let claims: AccessTokenClaims | undefined;
      let authenticating = false;
      const authTimer = setTimeout(
        () =>
          socket.close(closeCodes.unauthenticated, "Authentication timed out."),
        authTimeoutMs,
      );

      socket.on("close", () => {
        clearTimeout(authTimer);
        if (claims) connections.remove(claims.sessionId, socket);
      });

      socket.on("message", async (data, isBinary) => {
        const message = isBinary ? null : parseEnvelope(data.toString());
        if (!message) {
          socket.close(closeCodes.malformedMessage, "Malformed message.");
          return;
        }

        if (!claims) {
          const token = message.payload.accessToken;
          // Clients wait for auth.ok before sending anything else.
          if (
            authenticating ||
            message.type !== "auth" ||
            typeof token !== "string"
          ) {
            socket.close(closeCodes.unauthenticated, "Authenticate first.");
            return;
          }
          authenticating = true;
          let result: AccessTokenClaims | null;
          try {
            result = await getAuth().authenticate(token);
          } catch (error) {
            request.log.error(
              { err: error },
              "WebSocket authentication failed.",
            );
            socket.close(closeCodes.internalError, "Service unavailable.");
            return;
          }
          authenticating = false;
          if (!result) {
            socket.close(
              closeCodes.unauthenticated,
              "Invalid or expired token.",
            );
            return;
          }
          // Timed out or closed by the client while the session was checked.
          if (socket.readyState !== socket.OPEN) return;
          clearTimeout(authTimer);
          claims = result;
          connections.add(claims.sessionId, socket);
          send(socket, "auth.ok", { userId: claims.userId }, message.requestId);
          return;
        }

        try {
          switch (message.type) {
            case "ping":
              send(socket, "pong", {}, message.requestId);
              return;
            case "match.subscribe":
              await subscribe(socket, claims.userId, message);
              return;
            case "match.unsubscribe":
              unsubscribe(socket, message);
              return;
            default:
              sendError(
                socket,
                message.requestId,
                "UNSUPPORTED_MESSAGE",
                `Unsupported message type: ${message.type.slice(0, 64)}`,
              );
          }
        } catch (error) {
          request.log.error({ err: error }, "WebSocket message failed.");
          sendError(
            socket,
            message.requestId,
            "INTERNAL_ERROR",
            "Internal server error.",
          );
        }
      });
    },
  );
}
