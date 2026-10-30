import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { AccessTokenClaims } from "../core/tokens.ts";
import type { AuthService } from "../services/auth-service.ts";
import type { ConnectionRegistry } from "../services/connection-registry.ts";
import type {
  ErrorCode,
  GameAction,
  GameCommand,
  GameCommandService,
} from "../services/game-command-service.ts";

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

const gameTypes: readonly unknown[] = ["gomoku", "othello"];
// game_commands.command_id is a uuid column.
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAction(value: unknown): GameAction | null {
  if (!isObject(value)) return null;
  if (value.type === "resign") return { type: "resign" };
  const { row, col } = value;
  if (
    value.type === "place" &&
    Number.isSafeInteger(row) &&
    Number.isSafeInteger(col)
  ) {
    return { type: "place", row: row as number, col: col as number };
  }
  return null;
}

// Runtime check of the shared GameCommand contract (IF-01). Board range and
// legality are the engine's job; the actor comes from authentication, never
// from the payload.
export function parseCommand(
  payload: Record<string, unknown>,
): Omit<GameCommand, "userId"> | null {
  const { matchId, gameType, commandId, expectedVersion } = payload;
  const action = parseAction(payload.action);
  if (
    !isMatchId(matchId) ||
    !gameTypes.includes(gameType) ||
    typeof commandId !== "string" ||
    !uuidPattern.test(commandId) ||
    !Number.isSafeInteger(expectedVersion) ||
    (expectedVersion as number) < 0 ||
    !action
  ) {
    return null;
  }
  return {
    matchId,
    commandId,
    expectedVersion: expectedVersion as number,
    action,
  };
}

const rejectMessages: Record<ErrorCode, string> = {
  NOT_FOUND: "Match not found.",
  NOT_PARTICIPANT: "Only players of this match can play.",
  COMMAND_ID_CONFLICT: "commandId was already used by another player.",
  GAME_FINISHED: "The match is finished.",
  GAME_NOT_ACTIVE: "The match is not in progress.",
  VERSION_CONFLICT: "The match changed. Use the latest snapshot.",
  NOT_YOUR_TURN: "It is not your turn.",
  INVALID_ACTION: "The move is not allowed.",
};

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
    const replaced = connections.subscribe(matchId, userId, socket);
    if (replaced && replaced.readyState === replaced.OPEN) {
      send(replaced, "session.replaced", { matchId });
    }
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

  // Only the user's control connection for the match may send commands.
  // Replies go to the sender; the new state goes to every subscriber, and
  // only after apply() has committed.
  async function command(
    socket: WebSocket,
    userId: number,
    { requestId, payload }: Envelope,
  ) {
    const parsed = parseCommand(payload);
    if (!parsed) {
      sendError(
        socket,
        requestId,
        "INVALID_MESSAGE",
        "Invalid game.command payload.",
      );
      return;
    }
    const { matchId, commandId } = parsed;
    const gameError = (code: string, message: string, duplicate = false) =>
      send(
        socket,
        "game.error",
        { code, message, matchId, commandId, duplicate },
        requestId,
      );
    if (!connections.isSubscribed(matchId, socket)) {
      gameError("NOT_SUBSCRIBED", "Subscribe to the match first.");
      return;
    }
    if (!connections.isController(matchId, userId, socket)) {
      gameError("SESSION_REPLACED", "Another connection controls this match.");
      return;
    }

    const games = getGames();
    const result = await games.apply({ ...parsed, userId });
    if (result.status === "rejected") {
      gameError(result.code, rejectMessages[result.code], result.duplicate);
      if (result.code === "VERSION_CONFLICT") {
        send(socket, "match.snapshot", (await games.getSnapshot(matchId))!);
      }
      return;
    }
    send(
      socket,
      "game.ack",
      {
        matchId,
        commandId,
        stateVersion: result.stateVersion,
        duplicate: result.duplicate,
      },
      requestId,
    );
    // A resent command was already broadcast the first time.
    if (result.duplicate) return;
    // The snapshot may already include later commits; broadcastUpdate skips
    // it when an equal or newer state already went out (SDS 12번 순서).
    const snapshot = (await games.getSnapshot(matchId))!;
    connections.broadcastUpdate(matchId, snapshot.stateVersion, {
      type: "game.updated",
      payload: snapshot,
    });
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
            case "game.command":
              await command(socket, claims.userId, message);
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
