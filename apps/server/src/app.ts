import Fastify, {
  type FastifyError,
  type FastifyReply,
  type FastifyServerOptions,
} from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import type { GameType } from "@cafe/game-contracts";
import { createDatabase } from "./db/client.ts";
import { registerAuthRoutes } from "./api/auth-routes.ts";
import { registerUserRoutes } from "./api/user-routes.ts";
import { registerFriendRoutes } from "./api/friend-routes.ts";
import { registerStatsRoutes } from "./api/stats-routes.ts";
import { registerAvatarRoutes } from "./api/avatar-routes.ts";
import { errorBody } from "./schemas/errors.ts";
import {
  createAuthService,
  ServiceUnavailableError,
  TWO_FACTOR_NOT_CONFIGURED,
  type AuthConfig,
  type AuthService,
} from "./services/auth-service.ts";
import { registerTwoFactorRoutes } from "./api/two-factor-routes.ts";
import { registerOAuthRoutes } from "./api/oauth-routes.ts";
import { create42Client, OAuthProviderError } from "./core/oauth-42.ts";
import {
  createOAuthService,
  type OAuthService,
} from "./services/oauth-service.ts";
import { createSecretBox } from "./core/secret-box.ts";
import {
  createTwoFactorService,
  type TwoFactorService,
} from "./services/two-factor-service.ts";
import {
  createUserService,
  type UserService,
} from "./services/user-service.ts";
import {
  createFriendService,
  type FriendService,
} from "./services/friend-service.ts";
import {
  createStatsService,
  type StatsService,
} from "./services/stats-service.ts";
import {
  avatarMaxBytes,
  createAvatarService,
  type AvatarService,
} from "./services/avatar-service.ts";
import {
  createAccountService,
  type AccountService,
} from "./services/account-service.ts";
import { createConnectionRegistry } from "./services/connection-registry.ts";
import { createPresence, type Presence } from "./services/presence.ts";
import {
  createGameCommandService,
  type GameCommandService,
  type RegisteredRules,
} from "./services/game-command-service.ts";
import {
  closeCodes,
  registerRealtimeRoutes,
  type RealtimeConfig,
} from "./api/ws-routes.ts";

const unavailableCodes = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"]);

// Connection-level failures (DB down, pool timeout) and statement timeouts
// (57014, includes lock waits) map to 503, not 500.
function isDatabaseUnavailable(error: unknown) {
  if (error instanceof ServiceUnavailableError) return true;
  for (
    let e = error as
      { code?: unknown; message?: unknown; cause?: unknown } | undefined;
    e;
    e = e.cause as typeof e
  ) {
    const code = typeof e.code === "string" ? e.code : "";
    const message = typeof e.message === "string" ? e.message : "";
    if (
      unavailableCodes.has(code) ||
      code.startsWith("08") ||
      code === "57014" ||
      code.startsWith("57P") ||
      message.includes("timeout exceeded when trying to connect") ||
      message.includes("Connection terminated")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Fastify 앱을 만들고 서비스·공통 오류 처리·Swagger·route를 등록합니다.
 *
 * @param databaseUrl - 없으면 DB가 필요한 route는 503으로 답합니다.
 * @param authConfig - 없으면 인증이 필요한 route는 503으로 답합니다. 2FA 키·42 OAuth 설정이 빠지면 그 기능만 503입니다.
 * @param friendIdsOf - #98 테스트의 presence 수신자 조회 주입점입니다. 생략하면 실제 친구 서비스의 수락된 관계를 조회합니다.
 *
 * @remarks
 * 서비스는 설정이 있을 때만 만들고 route에는 getter로 넘깁니다. 설정이 없으면 getter가 {@link ServiceUnavailableError}를 던집니다.
 * 공통 오류 처리는 검증 실패·본문 오류·요청 과다·42 장애·DB 연결 장애를 정해진 오류 본문으로 바꾸고, 나머지는 500으로 답합니다.
 * 앱을 닫으면 DB 풀도 닫습니다.
 */
export async function buildApp(
  options: FastifyServerOptions = {},
  databaseUrl?: string,
  authConfig?: AuthConfig,
  // Directory for uploaded avatars. Without it the avatar endpoints answer 503.
  avatarDir?: string,
  realtimeConfig?: RealtimeConfig,
  // Game engines (C) by game type; a match of an unregistered type cannot be
  // created or shown.
  rulesByGameType: Partial<Record<GameType, RegisteredRules>> = {},
  // #98 원본 테스트의 수신자 주입 지점입니다. 실제 기동은 친구 서비스 조회를 씁니다.
  friendIdsOf?: (userId: number) => Promise<number[]>,
) {
  const app = Fastify({
    // A path parameter that is not valid %-encoding or is over 100 characters
    // fails in the router, before setErrorHandler. Answer it like any other
    // invalid parameter (#150).
    frameworkErrors: (error, _request, routeReply) => {
      const reply = routeReply as FastifyReply;
      if (
        error.code === "FST_ERR_BAD_URL" ||
        error.code === "FST_ERR_MAX_PARAM_LENGTH"
      ) {
        return reply
          .code(422)
          .send(errorBody("VALIDATION_ERROR", "Invalid path parameter."));
      }
      return reply
        .code(500)
        .send(errorBody("INTERNAL_ERROR", "Internal server error."));
    },
    ...options,
  });
  const database = databaseUrl
    ? createDatabase(databaseUrl, () =>
        app.log.error("Database pool connection lost."),
      )
    : undefined;
  const twoFactor =
    database && authConfig?.twoFactorKey
      ? createTwoFactorService(
          database.db,
          createSecretBox(authConfig.twoFactorKey),
        )
      : undefined;
  // Without a DB the default message applies; with one, only the key is missing.
  const getTwoFactor = (): TwoFactorService => {
    if (!twoFactor) {
      throw new ServiceUnavailableError(
        database ? TWO_FACTOR_NOT_CONFIGURED : undefined,
      );
    }
    return twoFactor;
  };
  // The registry reports presence changes; presence reads the registry.
  let presence: Presence | undefined;
  const connections = createConnectionRegistry({
    onPresenceChange: (userId) => void presence?.notifyPresence(userId),
  });
  // A session revoked for refresh token reuse also closes its WebSocket
  // connections, like logout does below.
  const auth =
    database && authConfig
      ? createAuthService(database.db, authConfig, twoFactor, (sessionId) =>
          connections.closeSession(
            sessionId,
            closeCodes.unauthenticated,
            "Session ended.",
          ),
        )
      : undefined;
  const getAuth = (): AuthService => {
    if (!auth) throw new ServiceUnavailableError();
    return auth;
  };
  // Logout also closes the WebSocket connections opened with that session.
  const routeAuth: AuthService | undefined = auth && {
    ...auth,
    async logout(sessionId: string) {
      await auth.logout(sessionId);
      connections.closeSession(
        sessionId,
        closeCodes.unauthenticated,
        "Session ended.",
      );
    },
  };
  const getRouteAuth = (): AuthService => {
    if (!routeAuth) throw new ServiceUnavailableError();
    return routeAuth;
  };
  const oauth =
    auth && authConfig?.oauth42
      ? createOAuthService(
          database!.db,
          create42Client(authConfig.oauth42),
          auth,
        )
      : undefined;
  const getOAuth = (): OAuthService => {
    if (!oauth) {
      throw new ServiceUnavailableError(
        auth ? "42 login is not configured." : undefined,
      );
    }
    return oauth;
  };
  const users = database ? createUserService(database.db) : undefined;
  const getUsers = (): UserService => {
    if (!users) throw new ServiceUnavailableError();
    return users;
  };
  // 미게시 인수 후보 전용 연결입니다. 원본과의 차이는 provenance 문서에 기록합니다.
  const friends = database
    ? createFriendService(database.db, connections.isUserOnline)
    : undefined;
  presence = createPresence({
    connections: {
      isUserOnline: connections.isUserOnline,
      sendToUser(userId, message) {
        try {
          connections.sendToUser(userId, message);
        } catch (error) {
          // 한 사용자 전송 실패가 상대 알림이나 이미 commit된 REST 성공을 바꾸지 않습니다.
          app.log.error({ err: error, userId }, "Friend notification failed.");
        }
      },
    },
    friendIdsOf:
      friendIdsOf ??
      ((userId) =>
        friends?.listAcceptedFriendIds(userId) ?? Promise.resolve([])),
    onError: (error) =>
      app.log.error({ err: error }, "Presence friend lookup failed."),
  });
  const routeFriends: FriendService | undefined = friends && {
    ...friends,
    async requestFriend(actorId, otherId) {
      const result = await friends.requestFriend(actorId, otherId);
      if (result.ok) presence?.notifyFriendsChanged(actorId, otherId);
      return result;
    },
    async decide(actorId, requestId, action) {
      const result = await friends.decide(actorId, requestId, action);
      if (result.ok)
        presence?.notifyFriendsChanged(actorId, result.result.userId);
      return result;
    },
    async removeFriend(actorId, otherId) {
      const result = await friends.removeFriend(actorId, otherId);
      if (result.ok) presence?.notifyFriendsChanged(actorId, otherId);
      return result;
    },
  };
  const getFriends = (): FriendService => {
    if (!routeFriends) throw new ServiceUnavailableError();
    return routeFriends;
  };
  const stats = database ? createStatsService(database.db) : undefined;
  const getStats = (): StatsService => {
    if (!stats) throw new ServiceUnavailableError();
    return stats;
  };
  const avatars =
    database && avatarDir
      ? createAvatarService(database.db, avatarDir)
      : undefined;
  const getAvatars = (): AvatarService => {
    if (!avatars) throw new ServiceUnavailableError();
    return avatars;
  };
  // Account deletion revokes every session of the user; close their sockets.
  const accounts = database
    ? createAccountService(
        database.db,
        twoFactor,
        avatars,
        (sessionIds) => {
          for (const sessionId of sessionIds) {
            connections.closeSession(
              sessionId,
              closeCodes.unauthenticated,
              "Session ended.",
            );
          }
        },
        (userId, friendIds) => {
          for (const friendId of friendIds)
            presence?.notifyFriendsChanged(userId, friendId);
        },
      )
    : undefined;
  const getAccounts = (): AccountService => {
    if (!accounts) throw new ServiceUnavailableError();
    return accounts;
  };
  const games = database
    ? createGameCommandService(database.db, rulesByGameType)
    : undefined;
  const getGames = (): GameCommandService => {
    if (!games) throw new ServiceUnavailableError();
    return games;
  };
  app.addHook("onClose", async () => {
    await database?.close();
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation) {
      return reply.code(422).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: {
            issues: error.validation.map((issue) => ({
              path: issue.instancePath,
              message: issue.message,
            })),
          },
        },
      });
    }
    if (error.statusCode === 429) {
      return reply
        .code(429)
        .send(errorBody("RATE_LIMITED", "Too many requests."));
    }
    if (error.statusCode === 413) {
      return reply
        .code(413)
        .send(errorBody("PAYLOAD_TOO_LARGE", "Request body is too large."));
    }
    if (error.statusCode === 415) {
      return reply
        .code(415)
        .send(errorBody("UNSUPPORTED_MEDIA_TYPE", "Use application/json."));
    }
    if (error.statusCode === 400) {
      return reply
        .code(400)
        .send(errorBody("BAD_REQUEST", "Malformed request body."));
    }
    if (error instanceof OAuthProviderError) {
      request.log.error("42 OAuth provider error.");
      return reply
        .code(502)
        .send(errorBody("OAUTH_PROVIDER_ERROR", "42 login is unavailable."));
    }
    if (isDatabaseUnavailable(error)) {
      // A missing setting names itself; DB failures keep the generic message.
      const message =
        error instanceof ServiceUnavailableError
          ? error.message
          : "Database is unavailable.";
      request.log.error(message);
      return reply.code(503).send(errorBody("SERVICE_UNAVAILABLE", message));
    }
    request.log.error({ err: error }, "Unhandled error.");
    return reply
      .code(500)
      .send(errorBody("INTERNAL_ERROR", "Internal server error."));
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(errorBody("NOT_FOUND", "Route not found.")),
  );
  // JSON-only API: other bodies get 415 instead of failing validation as text.
  app.removeContentTypeParser("text/plain");
  // The multipart parser is global; only routes that declare it accept it.
  app.addHook("preValidation", async (request, reply) => {
    const consumes = request.routeOptions.schema?.consumes;
    if (request.isMultipart() && !consumes?.includes("multipart/form-data")) {
      return reply
        .code(415)
        .send(errorBody("UNSUPPORTED_MEDIA_TYPE", "Use application/json."));
    }
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: avatarMaxBytes, files: 1 },
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  await app.register(swagger, {
    openapi: {
      info: { title: "Cyber Board Cafe API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get(
    "/api/health",
    {
      schema: {
        tags: ["health"],
        summary: "서버 동작 확인",
        description:
          "DB를 확인하지 않습니다. DB 연결은 `/api/health/db`로 확인합니다.",
        response: {
          200: {
            description: "서버가 요청을 받고 있음",
            type: "object",
            properties: { status: { type: "string", const: "ok" } },
            required: ["status"],
          },
        },
      },
    },
    async () => ({ status: "ok" }),
  );
  app.get(
    "/api/health/db",
    {
      schema: {
        tags: ["health"],
        operationId: "checkDatabaseHealth",
        summary: "DB 연결 확인",
        description:
          "PostgreSQL의 연결 확인용 테이블을 조회합니다. 인증이나 요청 파라미터는 필요하지 않습니다. 연결 및 테이블 조회 성공 시 200, DB 미설정·연결 실패·테이블 미준비 시 503을 반환합니다.",
        response: {
          200: {
            description: "PostgreSQL 연결 및 확인용 테이블 조회 성공",
            type: "object",
            properties: {
              status: { type: "string", const: "ok" },
              database: { type: "string", const: "ok" },
            },
            required: ["status", "database"],
          },
          503: {
            description: "DB 미설정, 연결 실패 또는 확인용 테이블 조회 실패",
            type: "object",
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string", const: "SERVICE_UNAVAILABLE" },
                  message: { type: "string" },
                },
                required: ["code", "message"],
              },
            },
            required: ["error"],
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        if (!database) throw new Error("Database is not configured.");
        await database.check();
        return { status: "ok", database: "ok" };
      } catch {
        return reply.code(503).send({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Database is unavailable.",
          },
        });
      }
    },
  );
  registerAuthRoutes(app, getRouteAuth);
  registerTwoFactorRoutes(app, getAuth, getTwoFactor);
  registerOAuthRoutes(app, getAuth, getOAuth);
  registerUserRoutes(app, getAuth, getUsers, getAccounts);
  registerFriendRoutes(app, getAuth, getFriends);
  registerStatsRoutes(app, getAuth, getStats);
  registerAvatarRoutes(app, getAuth, getAvatars);
  registerRealtimeRoutes(app, getAuth, getGames, connections, realtimeConfig);
  return app;
}
