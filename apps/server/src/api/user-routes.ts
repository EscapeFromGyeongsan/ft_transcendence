import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth-service.ts";
import type { UserService } from "../services/user-service.ts";
import type { ProfileUpdate } from "../repositories/user-repository.ts";
import {
  bodyErrorResponses,
  errorBody,
  errorSchema,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";
import {
  createRequireAuth,
  nicknameSchema,
  userSchema,
} from "./auth-routes.ts";

const profileSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    nickname: { type: "string" },
    avatarUrl: { type: ["string", "null"] },
  },
  required: ["id", "nickname", "avatarUrl"],
};

const signedOut = () =>
  errorBody("UNAUTHENTICATED", "Authentication required.");

/**
 * 내 정보 조회·닉네임/전적 공개 설정 변경·공개 프로필 route를 등록합니다.
 *
 * @remarks 서비스 getter가 설정 없음으로 {@link ServiceUnavailableError}를 던지면 503이 됩니다.
 */
export function registerUserRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getUsers: () => UserService,
) {
  const requireAuth = createRequireAuth(getAuth);

  app.get(
    "/api/users/me",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["users"],
        summary: "내 계정 정보",
        security: [{ bearerAuth: [] }],
        response: {
          200: { description: "조회 성공", ...userSchema },
          401: unauthenticatedResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const user = await getAuth().getUser(request.auth!.userId);
      // Session is active but the account row is gone: treat as signed out.
      if (!user) return reply.code(401).send(signedOut());
      return user;
    },
  );

  app.patch<{ Body: ProfileUpdate }>(
    "/api/users/me",
    {
      onRequest: requireAuth,
      // Reject malformed settings before Ajv can coerce "false", 0 or null
      // into a boolean, or remove unknown properties before checking emptiness.
      preValidation: async (request, reply) => {
        const body: unknown = request.body;
        if (body !== null && typeof body === "object" && !Array.isArray(body)) {
          const fields = Object.keys(body);
          if (
            fields.some(
              (key) => key !== "nickname" && key !== "recordsPublic",
            ) ||
            ("recordsPublic" in body && typeof body.recordsPublic !== "boolean")
          ) {
            return reply
              .code(422)
              .send(errorBody("VALIDATION_ERROR", "Invalid profile fields."));
          }
        }
      },
      schema: {
        tags: ["users"],
        summary: "내 닉네임·전적 공개 설정 변경",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            nickname: nicknameSchema,
            recordsPublic: { type: "boolean" },
          },
          anyOf: [{ required: ["nickname"] }, { required: ["recordsPublic"] }],
          additionalProperties: false,
        },
        response: {
          200: { description: "변경 성공", ...userSchema },
          ...bodyErrorResponses,
          401: unauthenticatedResponse,
          409: errorSchema("닉네임 중복", ["NICKNAME_TAKEN"]),
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await getUsers().updateProfile(
        request.auth!.userId,
        request.body,
      );
      if (result.ok) return result.user;
      if (result.code === "NOT_FOUND") return reply.code(401).send(signedOut());
      return reply
        .code(409)
        .send(errorBody("NICKNAME_TAKEN", "Nickname is already taken."));
    },
  );

  app.get<{ Params: { userId: number } }>(
    "/api/users/:userId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["users"],
        summary: "다른 사용자 프로필",
        description:
          "공개 필드(닉네임, 아바타)만 반환합니다. 이메일은 포함하지 않습니다.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          properties: {
            userId: {
              type: "integer",
              minimum: 1,
              maximum: Number.MAX_SAFE_INTEGER,
            },
          },
          required: ["userId"],
        },
        response: {
          200: { description: "조회 성공", ...profileSchema },
          401: unauthenticatedResponse,
          404: errorSchema("존재하지 않는 사용자", ["NOT_FOUND"]),
          422: bodyErrorResponses[422],
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const profile = await getUsers().getProfile(request.params.userId);
      if (!profile) {
        return reply.code(404).send(errorBody("NOT_FOUND", "User not found."));
      }
      return profile;
    },
  );
}
