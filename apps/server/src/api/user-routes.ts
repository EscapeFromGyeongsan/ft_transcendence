import type { FastifyInstance } from "fastify";
import type { AccountService } from "../services/account-service.ts";
import type { AuthService } from "../services/auth-service.ts";
import type { UserService } from "../services/user-service.ts";
import type { ProfileUpdate } from "../repositories/user-repository.ts";
import {
  bodyErrorResponses,
  errorBody,
  errorSchema,
  rateLimitResponse,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";
import {
  authRateLimit,
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

// 탈퇴 화면이 본인 확인 입력란(비밀번호 또는 2FA 코드)을 고를 수 있게 비밀번호 유무를 함께 돌려줍니다.
const meSchema = {
  ...userSchema,
  properties: { ...userSchema.properties, hasPassword: { type: "boolean" } },
  required: [...userSchema.required, "hasPassword"],
};

const signedOut = () =>
  errorBody("UNAUTHENTICATED", "Authentication required.");

/**
 * 내 정보 조회·닉네임/전적 공개 설정 변경·회원 탈퇴·공개 프로필 route를 등록합니다.
 *
 * @remarks 서비스 getter가 설정 없음으로 {@link ServiceUnavailableError}를 던지면 503이 됩니다.
 */
export function registerUserRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getUsers: () => UserService,
  getAccounts: () => AccountService,
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
          200: { description: "조회 성공", ...meSchema },
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

  app.delete<{ Body: { password?: string; code?: string } | undefined }>(
    "/api/users/me",
    {
      onRequest: requireAuth,
      // A recent-login OAuth account may send no body at all.
      preValidation: async (request) => {
        request.body ??= {};
      },
      config: authRateLimit,
      schema: {
        tags: ["users"],
        summary: "회원 탈퇴",
        description:
          "비밀번호로 본인임을 확인합니다. 비밀번호가 없는 42 OAuth 계정은 2FA 코드(복구 코드 포함), 2FA도 없으면 10분 안의 로그인이 필요합니다. 진행 중 경기가 있으면 탈퇴할 수 없습니다. 개인정보와 로그인 수단은 삭제하고 경기 기록은 경기 당시 닉네임으로 남깁니다(DEC-09).",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            password: { type: "string", minLength: 1, maxLength: 128 },
            code: { type: "string", minLength: 1, maxLength: 32 },
          },
          additionalProperties: false,
        },
        response: {
          204: { description: "탈퇴 완료. 모든 세션이 폐기됨", type: "null" },
          ...bodyErrorResponses,
          400: errorSchema("JSON 오류 또는 본인 확인 실패", [
            "BAD_REQUEST",
            "INVALID_CREDENTIALS",
            "INVALID_TWO_FACTOR_CODE",
          ]),
          401: unauthenticatedResponse,
          403: errorSchema("최근 로그인 필요 (OAuth 전용·2FA 미사용 계정)", [
            "RECENT_LOGIN_REQUIRED",
          ]),
          409: errorSchema("진행 중이거나 대기 중인 경기가 있음", [
            "ACTIVE_MATCH",
          ]),
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await getAccounts().deleteAccount(
        request.auth!.userId,
        request.auth!.sessionId,
        request.body ?? {},
      );
      if (result.ok) return reply.code(204).send();
      switch (result.code) {
        case "NOT_FOUND":
          return reply.code(401).send(signedOut());
        case "INVALID_CREDENTIALS":
          return reply
            .code(400)
            .send(errorBody(result.code, "Password is incorrect."));
        case "INVALID_TWO_FACTOR_CODE":
          return reply
            .code(400)
            .send(errorBody(result.code, "Two-factor code is incorrect."));
        case "RECENT_LOGIN_REQUIRED":
          return reply
            .code(403)
            .send(
              errorBody(result.code, "Log in again to delete the account."),
            );
        case "ACTIVE_MATCH":
          return reply
            .code(409)
            .send(errorBody(result.code, "Finish the current match first."));
      }
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
