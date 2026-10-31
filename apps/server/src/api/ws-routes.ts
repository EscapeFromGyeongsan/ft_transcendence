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

/**
 * WebSocket으로 주고받는 모든 메시지의 공통 형식(IF-03, SDS 2.5의 9번)입니다.
 *
 * @remarks
 * 클라이언트 요청에 `requestId`가 있으면 서버는 그 요청에 대한 응답·오류에
 * 같은 값을 돌려줍니다. broadcast처럼 요청과 무관한 메시지에는 없습니다.
 */
export type Envelope = {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
};

/**
 * 서버가 연결을 닫을 때 쓰는 WebSocket close code입니다.
 *
 * @remarks
 * - `unauthenticated`(4401): 인증 시간 초과, 토큰 무효·만료, 인증 전 다른
 *   메시지, 로그아웃으로 인한 세션 폐기
 * - `malformedMessage`(4400): JSON이 아니거나 envelope 형식이 틀린 메시지,
 *   binary 메시지
 * - `internalError`(1011): 인증 서비스 장애 등 서버 내부 오류
 */
export const closeCodes = {
  internalError: 1011,
  malformedMessage: 4400,
  unauthenticated: 4401,
} as const;

/** `/api/ws` 동작 설정입니다. 테스트에서 시간 값을 줄일 때 씁니다. */
export type RealtimeConfig = {
  /** 연결 후 첫 `auth` 메시지를 기다리는 시간(ms). 기본값 5000. */
  authTimeoutMs?: number;
};

const MAX_REQUEST_ID_LENGTH = 64;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 받은 텍스트 메시지를 {@link Envelope}로 해석합니다.
 *
 * @param data - WebSocket에서 받은 텍스트 프레임
 * @returns 형식이 맞으면 envelope, JSON이 아니거나 `type`·`payload`·`requestId`
 *   형식이 틀리면 `null`
 *
 * @remarks
 * `payload`는 객체여야 하고, `requestId`는 1~64자 문자열일 때만 받습니다.
 * payload 내부 필드는 메시지 종류별 처리에서 따로 검증합니다.
 */
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

/**
 * `game.command`의 payload를 공통 계약 `GameCommand` 형식으로 검증합니다(IF-01).
 *
 * @returns 형식이 맞으면 `userId`를 뺀 명령, 아니면 `null`
 *
 * @remarks
 * - `matchId`는 1 이상 safe integer, `gameType`은 알려진 게임, `commandId`는
 *   UUID(`game_commands.command_id`가 uuid 컬럼), `expectedVersion`은 0 이상 정수
 * - `action`은 `place`(정수 `row`/`col`) 또는 `resign`만 받고, 다른 필드는 버립니다.
 * - 좌표 범위·합법 여부는 엔진이 판단합니다.
 * - 행동하는 사용자는 payload가 아니라 인증된 연결에서 정합니다(IF-02).
 */
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

/**
 * WebSocket endpoint `/api/ws`를 등록합니다.
 *
 * @param getAuth - 연결 인증에 쓰는 인증 서비스. DB가 없으면 예외를 던지며,
 *   이때 연결은 1011로 닫힙니다.
 * @param getGames - 경기 조회·snapshot에 쓰는 경기 서비스(B)
 * @param connections - 인증된 연결을 세션별·경기별로 보관하는 목록. 로그아웃 시
 *   연결을 닫을 때 같은 인스턴스를 씁니다.
 *
 * @remarks
 * 보안: access token은 URL이 아니라 연결 후 첫 `auth` 메시지로만 받아 로그에
 * 남지 않게 합니다. `AuthService.authenticate()`로 JWT와 서버 세션을 함께
 * 확인하며, 인증은 연결 시점에만 합니다. 연결 중 access token이 만료돼도
 * 연결은 유지되고, 세션 폐기(로그아웃)만 연결을 닫습니다.
 *
 * 클라이언트는 `auth.ok`를 받기 전에 다른 메시지를 보내면 안 됩니다.
 * 인증 처리 중 들어온 메시지는 4401로 닫습니다.
 *
 * `match.subscribe`는 그 경기의 참가자만 할 수 있습니다. 구독 목록에 먼저
 * 등록한 뒤 snapshot을 읽으므로, 그 사이에 commit된 갱신도 놓치지 않습니다.
 * 클라이언트는 snapshot의 `stateVersion` 이하인 갱신을 버립니다. 같은 사용자가
 * 다른 연결로 구독하면 그 연결이 입력 권한을 가져가고, 이전 연결은
 * `session.replaced`를 받습니다.
 *
 * `game.command`는 입력 권한이 있는 연결만 보낼 수 있습니다. `apply()`가
 * commit하고 돌아온 뒤에만 전송합니다. 적용되면 요청자에게 `game.ack`, 구독자
 * 전체에 `game.updated`를 보내고, 거절되면 요청자에게만 `game.error`를
 * 보냅니다. 같은 `commandId` 재전송은 요청자에게만 응답합니다.
 */
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
