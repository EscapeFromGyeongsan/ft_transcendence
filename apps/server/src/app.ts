import Fastify, { type FastifyServerOptions } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { createDatabase } from "./db/client.ts";

export async function buildApp(
  options: FastifyServerOptions = {},
  databaseUrl?: string,
) {
  const app = Fastify(options);
  const database = databaseUrl
    ? createDatabase(databaseUrl, () =>
        app.log.error("Database pool connection lost."),
      )
    : undefined;
  app.addHook("onClose", async () => {
    await database?.close();
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Cyber Board Cafe API", version: "0.1.0" },
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
  return app;
}
