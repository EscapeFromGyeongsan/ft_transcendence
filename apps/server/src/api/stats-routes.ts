import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth-service.ts";
import type { StatsService } from "../services/stats-service.ts";
import {
  bodyErrorResponses,
  errorBody,
  errorSchema,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";
import { createRequireAuth } from "./auth-routes.ts";

const gameTypeSchema = { type: "string", enum: ["gomoku", "othello"] };
const userParams = {
  type: "object",
  properties: {
    userId: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
  required: ["userId"],
};
const notFound = errorSchema("존재하지 않는 사용자", ["NOT_FOUND"]);

/**
 * 전적 통계·경기 기록·리더보드 route를 등록합니다.
 *
 * @remarks 서비스 getter가 설정 없음으로 {@link ServiceUnavailableError}를 던지면 503이 됩니다.
 */
export function registerStatsRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getStats: () => StatsService,
) {
  const requireAuth = createRequireAuth(getAuth);

  app.get<{ Params: { userId: number }; Querystring: { gameType: string } }>(
    "/api/users/:userId/stats",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["statistics"],
        summary: "게임별 승·패·무와 승률",
        description:
          "종료된 경기만 집계합니다. 무효 경기는 played와 winRate에서 제외합니다. played가 0이면 winRate는 0입니다.",
        security: [{ bearerAuth: [] }],
        params: userParams,
        querystring: {
          type: "object",
          properties: { gameType: gameTypeSchema },
          required: ["gameType"],
        },
        response: {
          200: {
            description: "조회 성공",
            type: "object",
            properties: {
              userId: { type: "integer" },
              gameType: gameTypeSchema,
              wins: { type: "integer" },
              losses: { type: "integer" },
              draws: { type: "integer" },
              played: { type: "integer" },
              winRate: { type: "number" },
              achievements: {
                type: "object",
                properties: { firstWin: { type: "boolean" } },
                required: ["firstWin"],
              },
              progress: {
                type: "object",
                description:
                  "참여 진행도 (무효 제외 완료 경기 수, 최대 target)",
                properties: {
                  current: { type: "integer" },
                  target: { type: "integer", const: 10 },
                },
                required: ["current", "target"],
              },
            },
            required: [
              "achievements",
              "progress",
              "userId",
              "gameType",
              "wins",
              "losses",
              "draws",
              "played",
              "winRate",
            ],
          },
          401: unauthenticatedResponse,
          404: notFound,
          422: bodyErrorResponses[422],
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const stats = await getStats().getStats(
        request.params.userId,
        request.query.gameType,
      );
      if (!stats) {
        return reply.code(404).send(errorBody("NOT_FOUND", "User not found."));
      }
      return stats;
    },
  );

  app.get<{
    Params: { userId: number };
    Querystring: { gameType?: string; before?: number; limit: number };
  }>(
    "/api/users/:userId/matches",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["statistics"],
        summary: "종료된 경기 전적 (최신순)",
        description:
          "nextBefore 값을 before로 넘기면 다음(더 오래된) 페이지를 받습니다. 마지막 페이지면 nextBefore는 null입니다.",
        security: [{ bearerAuth: [] }],
        params: userParams,
        querystring: {
          type: "object",
          properties: {
            gameType: gameTypeSchema,
            before: {
              type: "integer",
              minimum: 1,
              maximum: Number.MAX_SAFE_INTEGER,
            },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
          },
        },
        response: {
          200: {
            description: "조회 성공",
            type: "object",
            properties: {
              matches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    matchId: { type: "integer" },
                    gameType: gameTypeSchema,
                    result: {
                      type: "string",
                      enum: ["win", "loss", "draw", "void"],
                    },
                    reason: { type: "string" },
                    seat: { type: "string", enum: ["black", "white"] },
                    opponent: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
                        nickname: {
                          type: "string",
                          description: "경기 당시 닉네임",
                        },
                        deleted: {
                          type: "boolean",
                          description:
                            "탈퇴한 사용자. 화면은 `(탈퇴한 사용자)`를 붙이고 프로필 링크를 만들지 않습니다.",
                        },
                      },
                      required: ["id", "nickname", "deleted"],
                    },
                    finishedAt: { type: "string", format: "date-time" },
                  },
                  required: [
                    "matchId",
                    "gameType",
                    "result",
                    "reason",
                    "seat",
                    "opponent",
                    "finishedAt",
                  ],
                },
              },
              nextBefore: { type: ["integer", "null"] },
            },
            required: ["matches", "nextBefore"],
          },
          401: unauthenticatedResponse,
          404: notFound,
          422: bodyErrorResponses[422],
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const page = await getStats().getMatches(
        request.params.userId,
        request.query,
      );
      if (!page) {
        return reply.code(404).send(errorBody("NOT_FOUND", "User not found."));
      }
      return page;
    },
  );

  app.get<{ Querystring: { gameType: string; limit: number } }>(
    "/api/leaderboard",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["statistics"],
        summary: "게임별 승수 순위",
        description:
          "승수 내림차순, 승률 내림차순, 사용자 ID 오름차순으로 정렬합니다(DEC-08). 무효를 제외한 완료 경기가 1경기 이상인 사용자만 포함합니다.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            gameType: gameTypeSchema,
            limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
          },
          required: ["gameType"],
        },
        response: {
          200: {
            description: "조회 성공",
            type: "array",
            items: {
              type: "object",
              properties: {
                rank: { type: "integer" },
                userId: { type: "integer" },
                nickname: { type: "string" },
                wins: { type: "integer" },
                played: { type: "integer" },
                winRate: { type: "number" },
              },
              required: [
                "rank",
                "userId",
                "nickname",
                "wins",
                "played",
                "winRate",
              ],
            },
          },
          401: unauthenticatedResponse,
          422: bodyErrorResponses[422],
          ...serverErrorResponses,
        },
      },
    },
    async (request) =>
      getStats().getLeaderboard(request.query.gameType, request.query.limit),
  );
}
