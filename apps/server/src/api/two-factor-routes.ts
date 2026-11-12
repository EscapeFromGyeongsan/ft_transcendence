import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth-service.ts";
import type { TwoFactorService } from "../services/two-factor-service.ts";
import {
  bodyErrorResponses,
  errorBody,
  parseErrorResponses,
  errorSchema,
  rateLimitResponse,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";
import {
  authRateLimit,
  createRequireAuth,
  tokenPairSchema,
} from "./auth-routes.ts";

const codeSchema = {
  type: "string",
  minLength: 6,
  maxLength: 16,
  description: "인증 앱의 6자리 코드 또는 복구 코드(ABCD-EFGH)",
};
const totpOnlySchema = {
  type: "string",
  pattern: "^\\d{6}$",
  description: "새로 등록한 인증 앱의 6자리 코드",
};
const invalidCode = errorSchema(
  "JSON 해석 불가 또는 틀린·이미 사용한 2FA 코드",
  ["BAD_REQUEST", "INVALID_TWO_FACTOR_CODE"],
);
const security = [{ bearerAuth: [] }];

/**
 * 2FA 상태 조회·설정·활성화·해제·로그인 확인 route를 등록합니다.
 *
 * @remarks 서비스 getter가 설정 없음으로 {@link ServiceUnavailableError}를 던지면 503이 됩니다(2FA 키가 없을 때 등).
 */
export function registerTwoFactorRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getTwoFactor: () => TwoFactorService,
) {
  const requireAuth = createRequireAuth(getAuth);

  app.post<{ Body: { challengeToken: string; code: string } }>(
    "/api/auth/2fa/verify",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "2FA 로그인 두 번째 단계",
        description:
          "로그인에서 받은 challengeToken과 코드를 보내면 세션을 만듭니다. challenge는 5분간 1회 사용할 수 있고, 틀린 코드 5번이면 폐기됩니다.",
        body: {
          type: "object",
          properties: {
            challengeToken: { type: "string", minLength: 1 },
            code: codeSchema,
          },
          required: ["challengeToken", "code"],
          additionalProperties: false,
        },
        response: {
          200: { description: "로그인 성공", ...tokenPairSchema },
          ...bodyErrorResponses,
          401: errorSchema("만료·사용·폐기된 challenge 또는 틀린 코드", [
            "UNAUTHENTICATED",
            "INVALID_TWO_FACTOR_CODE",
          ]),
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await getAuth().verifyTwoFactorLogin(
        request.body.challengeToken,
        request.body.code,
      );
      if (result.ok) return result.tokens;
      const message =
        result.code === "UNAUTHENTICATED"
          ? "Login challenge is invalid or expired. Log in again."
          : "Two-factor code is incorrect.";
      return reply.code(401).send(errorBody(result.code, message));
    },
  );

  app.get(
    "/api/auth/2fa",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["auth"],
        summary: "내 2FA 사용 여부",
        security,
        response: {
          200: {
            description: "조회 성공",
            type: "object",
            properties: { enabled: { type: "boolean" } },
            required: ["enabled"],
          },
          401: unauthenticatedResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request) => ({
      enabled: await getTwoFactor().isEnabled(request.auth!.userId),
    }),
  );

  app.post(
    "/api/auth/2fa/setup",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["auth"],
        summary: "2FA 설정 시작 (새 비밀값 발급)",
        description:
          "otpauthUrl을 QR로 보여 주고 인증 앱에 등록하게 합니다. enable로 코드를 확인하기 전까지 2FA는 꺼져 있습니다. 다시 호출하면 비밀값이 바뀝니다.",
        security,
        response: {
          200: {
            description: "비밀값 발급",
            type: "object",
            properties: {
              secret: { type: "string", description: "수동 입력용 base32" },
              otpauthUrl: { type: "string" },
            },
            required: ["secret", "otpauthUrl"],
          },
          ...parseErrorResponses,
          401: unauthenticatedResponse,
          409: errorSchema("이미 2FA 사용 중", ["TWO_FACTOR_ALREADY_ENABLED"]),
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const user = await getAuth().getUser(request.auth!.userId);
      if (!user) {
        return reply
          .code(401)
          .send(errorBody("UNAUTHENTICATED", "Authentication required."));
      }
      const result = await getTwoFactor().setup(user.id, user.email);
      if (!result.ok) {
        return reply
          .code(409)
          .send(errorBody(result.code, "Two-factor is already enabled."));
      }
      return { secret: result.secret, otpauthUrl: result.otpauthUrl };
    },
  );

  app.post<{ Body: { code: string } }>(
    "/api/auth/2fa/enable",
    {
      onRequest: requireAuth,
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "2FA 활성화 (코드 확인)",
        description:
          "복구 코드 10개를 한 번만 반환합니다. 각 코드는 1회용이며 기기를 잃었을 때 코드 대신 사용합니다.",
        security,
        body: {
          type: "object",
          properties: { code: totpOnlySchema },
          required: ["code"],
          additionalProperties: false,
        },
        response: {
          200: {
            description: "활성화 완료",
            type: "object",
            properties: {
              recoveryCodes: { type: "array", items: { type: "string" } },
            },
            required: ["recoveryCodes"],
          },
          ...bodyErrorResponses,
          400: invalidCode,
          401: unauthenticatedResponse,
          409: errorSchema("setup 전이거나 이미 사용 중", [
            "TWO_FACTOR_NOT_SET_UP",
            "TWO_FACTOR_ALREADY_ENABLED",
          ]),
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await getTwoFactor().enable(
        request.auth!.userId,
        request.body.code,
      );
      if (result.ok) return { recoveryCodes: result.recoveryCodes };
      if (result.code === "INVALID_TWO_FACTOR_CODE") {
        return reply
          .code(400)
          .send(errorBody(result.code, "Two-factor code is incorrect."));
      }
      const message =
        result.code === "TWO_FACTOR_NOT_SET_UP"
          ? "Start two-factor setup first."
          : "Two-factor is already enabled.";
      return reply.code(409).send(errorBody(result.code, message));
    },
  );

  app.post<{ Body: { code: string } }>(
    "/api/auth/2fa/disable",
    {
      onRequest: requireAuth,
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "2FA 비활성화",
        description: "현재 코드 또는 남은 복구 코드로 본인임을 확인합니다.",
        security,
        body: {
          type: "object",
          properties: { code: codeSchema },
          required: ["code"],
          additionalProperties: false,
        },
        response: {
          204: { description: "비활성화 완료", type: "null" },
          ...bodyErrorResponses,
          400: invalidCode,
          401: unauthenticatedResponse,
          409: errorSchema("2FA 미사용", ["TWO_FACTOR_NOT_ENABLED"]),
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await getTwoFactor().disable(
        request.auth!.userId,
        request.body.code,
      );
      if (result.ok) return reply.code(204).send();
      if (result.code === "INVALID_TWO_FACTOR_CODE") {
        return reply
          .code(400)
          .send(errorBody(result.code, "Two-factor code is incorrect."));
      }
      return reply
        .code(409)
        .send(errorBody(result.code, "Two-factor is not enabled."));
    },
  );
}
