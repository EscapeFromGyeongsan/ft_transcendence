import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { createDatabase } from "./db/client.ts";
import { registerAuthRoutes } from "./api/auth-routes.ts";
import { registerUserRoutes } from "./api/user-routes.ts";
import { registerStatsRoutes } from "./api/stats-routes.ts";
import { registerAvatarRoutes } from "./api/avatar-routes.ts";
import { errorBody } from "./schemas/errors.ts";
import {
  createAuthService,
  ServiceUnavailableError,
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
import {
  createAccountService,
  type AccountService,
} from "./services/account-service.ts";
import { createConnectionRegistry } from "./services/connection-registry.ts";
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
  const getTwoFactor = (): TwoFactorService => {
    if (!twoFactor) throw new ServiceUnavailableError();
    return twoFactor;
  };
  const auth =
    database && authConfig
      ? createAuthService(database.db, authConfig, twoFactor)
      : undefined;
  const getAuth = (): AuthService => {
    if (!auth) throw new ServiceUnavailableError();
    return auth;
  };
  const connections = createConnectionRegistry();
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
    if (!oauth) throw new ServiceUnavailableError();
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
  const accounts = database
    ? createAccountService(database.db, twoFactor, avatars)
    : undefined;
  const getAccounts = (): AccountService => {
    if (!accounts) throw new ServiceUnavailableError();
    return accounts;
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
      request.log.error("Database is unavailable.");
      return reply
        .code(503)
        .send(errorBody("SERVICE_UNAVAILABLE", "Database is unavailable."));
    }
    request.log.error({ err: error }, "Unhandled error.");
    return reply
      .code(500)
      .send(errorBody("INTERNAL_ERROR", "Internal server error."));
  });
  // JSON-only API: other bodies get 415 instead of failing validation as text.
  app.removeContentTypeParser("text/plain");
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
        response: {
          200: {
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
  registerStatsRoutes(app, getAuth, getStats);
  registerAvatarRoutes(app, getAuth, getAvatars);
  registerRealtimeRoutes(app, getAuth, connections, realtimeConfig);
  return app;
}
