import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import type { GameType } from "@cafe/game-contracts";
import { createDatabase } from "./db/client.ts";
import { registerAuthRoutes } from "./api/auth-routes.ts";
import { registerUserRoutes } from "./api/user-routes.ts";
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
  createStatsService,
  type StatsService,
} from "./services/stats-service.ts";
import {
  avatarMaxBytes,
  createAvatarService,
  type AvatarService,
} from "./services/avatar-service.ts";
import { createConnectionRegistry } from "./services/connection-registry.ts";
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
) {
  const app = Fastify(options);
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
  const connections = createConnectionRegistry();
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
  registerUserRoutes(app, getAuth, getUsers);
  registerStatsRoutes(app, getAuth, getStats);
  registerAvatarRoutes(app, getAuth, getAvatars);
  registerRealtimeRoutes(app, getAuth, getGames, connections, realtimeConfig);
  return app;
}
