import type { FastifyInstance, FastifyRequest } from "fastify";
import type { GameSnapshot, GameType } from "@cafe/game-contracts";
import type { RawData, WebSocket } from "ws";
import type { AccessTokenClaims } from "../core/tokens.ts";
import type { AuthService } from "../services/auth-service.ts";
import type { ConnectionRegistry } from "../services/connection-registry.ts";
import { createMatchmaking } from "../services/matchmaking.ts";
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
 * - `messageTooLarge`(1009): 16 KiB를 넘는 메시지. 서버 코드가 아니라 `ws`
 *   라이브러리가 `maxPayload` 설정에 따라 닫습니다.
 * - `tooManyPending`(1008): 처리를 기다리는 메시지가
 *   {@link MAX_PENDING_MESSAGES}개를 넘음
 */
export const closeCodes = {
  internalError: 1011,
  tooManyPending: 1008,
  messageTooLarge: 1009,
  malformedMessage: 4400,
  unauthenticated: 4401,
} as const;

/**
 * 한 연결에서 처리를 기다릴 수 있는 메시지 수입니다. 메시지는 연결마다
 * 순서대로 하나씩 처리하므로, DB 응답보다 빠르게 보내면 대기열이 늘어납니다.
 * 정상 클라이언트는 응답을 기다리며 보내므로 넘지 않는 값입니다.
 */
export const MAX_PENDING_MESSAGES = 32;

/**
 * `/api/ws` 연결 요청의 IP별 제한입니다. 인증 전 소켓은 최대 5초 유지되고
 * 인증마다 DB를 조회하므로, 연결을 반복해 자원을 소모하지 못하게 막습니다.
 * 새로고침·재연결이 잦은 정상 사용은 넘지 않는 값입니다.
 */
export const wsRateLimit = {
  rateLimit: {
    max: 30,
    timeWindow: "1 minute",
    // Real connections always have an IP; the fake socket of injectWS in
    // tests has none, which would crash the default key generator.
    keyGenerator: (request: FastifyRequest) => request.ip ?? "unknown",
  },
};

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
// game_commands.expected_version is an int4 column.
const MAX_EXPECTED_VERSION = 2_147_483_647;

function isGameType(value: unknown): value is GameType {
  return gameTypes.includes(value);
}
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
 *   UUID(`game_commands.command_id`가 uuid 컬럼), `expectedVersion`은
 *   0 이상 int4 범위 정수(`game_commands.expected_version`)
 * - `action`은 `place`(정수 `row`/`col`) 또는 `resign`만 받고, 다른 필드는 버립니다.
 * - 좌표 범위·합법 여부는 엔진이 판단합니다.
 * - 행동하는 사용자는 payload가 아니라 인증된 연결에서 정합니다(IF-02).
 */
export function parseCommand(
  payload: Record<string, unknown>,
): (Omit<GameCommand, "userId"> & { gameType: GameType }) | null {
  const { matchId, gameType, commandId, expectedVersion } = payload;
  const action = parseAction(payload.action);
  if (
    !isMatchId(matchId) ||
    !isGameType(gameType) ||
    typeof commandId !== "string" ||
    !uuidPattern.test(commandId) ||
    !Number.isSafeInteger(expectedVersion) ||
    (expectedVersion as number) < 0 ||
    (expectedVersion as number) > MAX_EXPECTED_VERSION ||
    !action
  ) {
    return null;
  }
  return {
    matchId,
    gameType: gameType as GameType,
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
 * 보냅니다. 같은 `commandId` 재전송도 처음 결과로 같은 경로를 탑니다. 적용된
 * 명령이면 요청자에게 `game.ack`(`duplicate: true`)를 보내고 최신 snapshot을
 * 구독자 전체에 다시 broadcast합니다. 처음 commit 뒤 snapshot 전송이 실패했을
 * 때 재전송으로 복구하기 위해서입니다. 이미 보낸 버전보다 새롭지 않으면
 * broadcast하지 않습니다(SDS 12번).
 *
 * `queue.join`/`queue.leave`는 자동 매칭 대기열({@link createMatchmaking})로
 * 넘기고, 연결이 닫히면 그 연결의 대기 항목을 뺍니다.
 *
 * 연결 요청(upgrade)은 IP마다 1분에 30번까지 받고({@link wsRateLimit}), 넘으면
 * upgrade 없이 HTTP 429 `RATE_LIMITED`로 응답합니다.
 */
export function registerRealtimeRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getGames: () => GameCommandService,
  connections: ConnectionRegistry,
  config: RealtimeConfig = {},
) {
  const authTimeoutMs = config.authTimeoutMs ?? 5000;
  // Game type of each match a socket has subscribed to, for command checks.
  // Kept after the match finishes, so a resent final command still gets its
  // duplicate ack and a new one gets GAME_FINISHED; dropped once nobody
  // watches the match.
  const matchGameTypes = new Map<number, GameType>();

  function dropUnwatched(matchIds: Iterable<number>) {
    for (const matchId of matchIds) {
      if (!connections.hasSubscribers(matchId)) matchGameTypes.delete(matchId);
    }
  }

  const matchmaking = createMatchmaking({
    getGames,
    send: (socket, type, payload) => send(socket, type, payload),
    notifyUser: (userId, type, payload) =>
      connections.sendToUser(userId, { type, payload }),
    onError: (error) => app.log.error({ err: error }, "Matchmaking failed."),
  });

  async function joinQueue(
    socket: WebSocket,
    userId: number,
    { requestId, payload }: Envelope,
  ) {
    const { gameType } = payload;
    if (!isGameType(gameType) || !getGames().isRegistered(gameType)) {
      sendError(socket, requestId, "INVALID_MESSAGE", "Invalid gameType.");
      return;
    }
    const result = await matchmaking.join(userId, socket, gameType);
    if (result === "joined") {
      send(socket, "queue.joined", { gameType }, requestId);
    } else if (result === "cancelled") {
      // Another tab left while this join was checking the DB.
      send(socket, "queue.left", {}, requestId);
    } else if (result === "ALREADY_ACTIVE") {
      sendError(
        socket,
        requestId,
        "ALREADY_ACTIVE",
        "Already queued or playing a match.",
      );
    }
  }

  function leaveQueue(
    socket: WebSocket,
    userId: number,
    { requestId }: Envelope,
  ) {
    if (matchmaking.leave(userId) === "ALREADY_MATCHED") {
      sendError(
        socket,
        requestId,
        "ALREADY_MATCHED",
        "A match is being created for you.",
      );
      return;
    }
    send(socket, "queue.left", {}, requestId);
  }

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
    const wasSubscribed = connections.isSubscribed(matchId, socket);
    const replaced = connections.subscribe(matchId, userId, socket);
    if (replaced && replaced.readyState === replaced.OPEN) {
      send(replaced, "session.replaced", { matchId });
    }
    // On failure undo only this request, not an earlier subscription.
    const undo = () => {
      if (wasSubscribed) return;
      connections.unsubscribe(matchId, socket);
      dropUnwatched([matchId]);
    };
    let snapshot: GameSnapshot | undefined;
    try {
      snapshot = await games.getSnapshot(matchId);
    } catch (error) {
      undo();
      throw error;
    }
    if (!snapshot) {
      undo();
      sendError(socket, requestId, "NOT_FOUND", "Match not found.", {
        matchId,
      });
      return;
    }
    matchGameTypes.set(matchId, snapshot.gameType);
    send(socket, "match.snapshot", snapshot, requestId);
  }

  function unsubscribe(socket: WebSocket, { requestId, payload }: Envelope) {
    const { matchId } = payload;
    if (!isMatchId(matchId)) {
      sendError(socket, requestId, "INVALID_MESSAGE", "Invalid matchId.");
      return;
    }
    connections.unsubscribe(matchId, socket);
    dropUnwatched([matchId]);
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
    const { matchId, gameType, commandId, expectedVersion, action } = parsed;
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
    if (gameType !== matchGameTypes.get(matchId)) {
      sendError(
        socket,
        requestId,
        "INVALID_MESSAGE",
        "gameType does not match the match.",
        { matchId },
      );
      return;
    }

    const games = getGames();
    const result = await games.apply({
      matchId,
      commandId,
      expectedVersion,
      action,
      userId,
    });
    if (result.status === "rejected") {
      gameError(result.code, rejectMessages[result.code], result.duplicate);
      if (result.code === "VERSION_CONFLICT") {
        const latest = await games.getSnapshot(matchId);
        if (latest) send(socket, "match.snapshot", latest);
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
    // Broadcast even for a resent command: if reading the snapshot failed
    // after the first commit, the resend delivers it. The snapshot may also
    // include later commits; broadcastUpdate skips any state that is not
    // newer than the last one sent (SDS 12번 순서).
    const snapshot = await games.getSnapshot(matchId);
    if (!snapshot) return;
    connections.broadcastUpdate(matchId, snapshot.stateVersion, {
      type: "game.updated",
      payload: snapshot,
    });
    if (snapshot.status === "finished") connections.forgetMatch(matchId);
  }

  // The access token arrives in the first message, never in the URL, so it
  // does not end up in proxy or access logs.
  app.get(
    "/api/ws",
    { websocket: true, schema: { hide: true }, config: wsRateLimit },
    (socket, request) => {
      let claims: AccessTokenClaims | undefined;
      // Session the socket is registered under, set before auth.ok.
      let registeredSession: string | undefined;
      const authTimer = setTimeout(
        () =>
          socket.close(closeCodes.unauthenticated, "Authentication timed out."),
        authTimeoutMs,
      );

      socket.on("close", () => {
        clearTimeout(authTimer);
        matchmaking.removeSocket(socket);
        if (registeredSession) {
          dropUnwatched(connections.remove(registeredSession, socket));
        }
      });

      // Messages of one socket are handled one at a time in arrival order,
      // so e.g. a match.unsubscribe never overtakes an earlier subscribe.
      let pending = Promise.resolve();
      let pendingCount = 0;
      let firstMessage = true;
      socket.on("message", (data, isBinary) => {
        // Only the auth message may come before auth.ok; anything else sent
        // while it is being checked is refused right away, not queued.
        if (!claims && !firstMessage) {
          socket.close(closeCodes.unauthenticated, "Authenticate first.");
          return;
        }
        firstMessage = false;
        // A client that does not wait for replies would grow the queue and
        // its DB reads without bound.
        if (pendingCount >= MAX_PENDING_MESSAGES) {
          socket.close(closeCodes.tooManyPending, "Too many pending messages.");
          return;
        }
        pendingCount++;
        pending = pending
          .then(() => handleMessage(data, isBinary))
          .catch((error) =>
            request.log.error({ err: error }, "WebSocket message failed."),
          )
          .finally(() => pendingCount--);
      });

      async function handleMessage(data: RawData, isBinary: boolean) {
        // Messages still queued when the socket closed are dropped.
        if (socket.readyState !== socket.OPEN) return;
        const message = isBinary ? null : parseEnvelope(data.toString());
        if (!message) {
          socket.close(closeCodes.malformedMessage, "Malformed message.");
          return;
        }

        if (!claims) {
          const token = message.payload.accessToken;
          if (message.type !== "auth" || typeof token !== "string") {
            socket.close(closeCodes.unauthenticated, "Authenticate first.");
            return;
          }
          let result: AccessTokenClaims | null;
          try {
            result = await getAuth().authenticate(token);
            if (result && socket.readyState === socket.OPEN) {
              // From here a logout closes this socket. A logout that
              // committed while the session was being checked found nothing
              // to close, so check the session once more.
              registeredSession = result.sessionId;
              connections.add(registeredSession, socket, result.userId);
              if (!(await getAuth().authenticate(token))) result = null;
            }
          } catch (error) {
            request.log.error(
              { err: error },
              "WebSocket authentication failed.",
            );
            socket.close(closeCodes.internalError, "Service unavailable.");
            return;
          }
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
            case "queue.join":
              await joinQueue(socket, claims.userId, message);
              return;
            case "queue.leave":
              leaveQueue(socket, claims.userId, message);
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
      }
    },
  );
}
