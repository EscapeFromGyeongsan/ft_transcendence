import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { AccessTokenClaims } from "../core/tokens.ts";
import type { AuthService } from "../services/auth-service.ts";
import type { ConnectionRegistry } from "../services/connection-registry.ts";

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
 */
export const closeCodes = {
  internalError: 1011,
  messageTooLarge: 1009,
  malformedMessage: 4400,
  unauthenticated: 4401,
} as const;

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

/**
 * WebSocket endpoint `/api/ws`를 등록합니다.
 *
 * @param getAuth - 연결 인증에 쓰는 인증 서비스. DB가 없으면 예외를 던지며,
 *   이때 연결은 1011로 닫힙니다.
 * @param connections - 인증된 연결을 세션별로 보관하는 목록. 로그아웃 시 연결을
 *   닫을 때 같은 인스턴스를 씁니다.
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
 * 연결 요청(upgrade)은 IP마다 1분에 30번까지 받고({@link wsRateLimit}), 넘으면
 * upgrade 없이 HTTP 429 `RATE_LIMITED`로 응답합니다.
 */
export function registerRealtimeRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  connections: ConnectionRegistry,
  config: RealtimeConfig = {},
) {
  const authTimeoutMs = config.authTimeoutMs ?? 5000;

  // The access token arrives in the first message, never in the URL, so it
  // does not end up in proxy or access logs.
  app.get(
    "/api/ws",
    { websocket: true, schema: { hide: true }, config: wsRateLimit },
    (socket, request) => {
      let claims: AccessTokenClaims | undefined;
      // Session the socket is registered under, set before auth.ok.
      let registeredSession: string | undefined;
      let authenticating = false;
      const authTimer = setTimeout(
        () =>
          socket.close(closeCodes.unauthenticated, "Authentication timed out."),
        authTimeoutMs,
      );

      socket.on("close", () => {
        clearTimeout(authTimer);
        if (registeredSession) {
          connections.remove(registeredSession, socket);
        }
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
            if (result && socket.readyState === socket.OPEN) {
              // From here a logout closes this socket. A logout that
              // committed while the session was being checked found nothing
              // to close, so check the session once more.
              registeredSession = result.sessionId;
              connections.add(registeredSession, socket);
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
          send(socket, "auth.ok", { userId: claims.userId }, message.requestId);
          return;
        }

        switch (message.type) {
          case "ping":
            send(socket, "pong", {}, message.requestId);
            return;
          default:
            send(
              socket,
              "error",
              {
                code: "UNSUPPORTED_MESSAGE",
                message: `Unsupported message type: ${message.type.slice(0, 64)}`,
              },
              message.requestId,
            );
        }
      });
    },
  );
}
