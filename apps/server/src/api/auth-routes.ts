import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccessTokenClaims } from "../core/tokens.ts";
import type { AuthService } from "../services/auth-service.ts";
import {
  bodyErrorResponses,
  errorBody,
  errorSchema,
  rateLimitResponse,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AccessTokenClaims;
  }
}

export const nicknameSchema = {
  type: "string",
  pattern: "^[\\p{L}\\p{N}_-]{2,32}$",
  description: "2~32자, 문자·숫자·_·-",
};

export const userSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    email: { type: "string" },
    nickname: { type: "string" },
    avatarUrl: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "email", "nickname", "avatarUrl", "createdAt"],
};

export const tokenPairSchema = {
  type: "object",
  properties: {
    accessToken: { type: "string" },
    tokenType: { type: "string", const: "Bearer" },
    expiresIn: { type: "integer", description: "access token 유효 시간(초)" },
    refreshToken: { type: "string" },
  },
  required: ["accessToken", "tokenType", "expiresIn", "refreshToken"],
};

const credentialsProperties = {
  email: { type: "string", format: "email", maxLength: 254 },
  password: { type: "string", minLength: 8, maxLength: 128 },
};

// Login answer for an account with 2FA: no session yet, only a short-lived
// challenge to send with a code to POST /api/auth/2fa/verify.
export const twoFactorChallengeSchema = {
  type: "object",
  properties: {
    twoFactorRequired: { type: "boolean", const: true },
    challengeToken: { type: "string" },
    expiresIn: { type: "integer", description: "challenge 유효 시간(초)" },
  },
  required: ["twoFactorRequired", "challengeToken", "expiresIn"],
};

export const loginResultSchema = {
  description:
    "2FA 미사용: 토큰 발급. 2FA 사용: twoFactorRequired와 challengeToken 반환",
  anyOf: [tokenPairSchema, twoFactorChallengeSchema],
};

// Brute-force guard for unauthenticated auth endpoints (per client IP).
export const authRateLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export function createRequireAuth(getAuth: () => AuthService) {
  return async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const claims = token ? await getAuth().authenticate(token) : null;
    if (!claims) {
      return reply
        .code(401)
        .send(errorBody("UNAUTHENTICATED", "Authentication required."));
    }
    request.auth = claims;
  };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
) {
  const requireAuth = createRequireAuth(getAuth);

  app.post<{ Body: { email: string; password: string; nickname: string } }>(
    "/api/auth/register",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "이메일 회원가입",
        body: {
          type: "object",
          properties: {
            ...credentialsProperties,
            nickname: nicknameSchema,
          },
          required: ["email", "password", "nickname"],
          additionalProperties: false,
        },
        response: {
          201: { description: "가입 성공", ...userSchema },
          ...bodyErrorResponses,
          409: errorSchema("이메일 또는 닉네임 중복", [
            "EMAIL_TAKEN",
            "NICKNAME_TAKEN",
          ]),
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await getAuth().register(request.body);
      if (!result.ok) {
        const message =
          result.code === "EMAIL_TAKEN"
            ? "Email is already registered."
            : "Nickname is already taken.";
        return reply.code(409).send(errorBody(result.code, message));
      }
      return reply.code(201).send(result.user);
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "이메일 로그인, 서버 세션 생성",
        description:
          "2FA를 켠 계정은 세션 대신 challengeToken을 받고, POST /api/auth/2fa/verify로 코드를 보내야 로그인됩니다.",
        body: {
          type: "object",
          properties: credentialsProperties,
          required: ["email", "password"],
          additionalProperties: false,
        },
        response: {
          200: loginResultSchema,
          ...bodyErrorResponses,
          401: errorSchema("이메일 또는 비밀번호 불일치", [
            "INVALID_CREDENTIALS",
          ]),
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await getAuth().login(request.body);
      if (!result) {
        return reply
          .code(401)
          .send(
            errorBody("INVALID_CREDENTIALS", "Email or password is incorrect."),
          );
      }
      return result;
    },
  );

  app.post<{ Body: { refreshToken: string } }>(
    "/api/auth/refresh",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "refresh token 교체와 access token 재발급",
        description:
          "사용한 refresh token은 폐기되고 새 token을 반환합니다. 이미 교체된 token을 다시 보내면 해당 세션 전체를 폐기합니다.",
        body: {
          type: "object",
          properties: { refreshToken: { type: "string", minLength: 1 } },
          required: ["refreshToken"],
          additionalProperties: false,
        },
        response: {
          200: { description: "재발급 성공", ...tokenPairSchema },
          ...bodyErrorResponses,
          401: errorSchema("만료·폐기·재사용·위조된 refresh token", [
            "UNAUTHENTICATED",
          ]),
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const tokens = await getAuth().refresh(request.body.refreshToken);
      if (!tokens) {
        return reply
          .code(401)
          .send(errorBody("UNAUTHENTICATED", "Refresh token is invalid."));
      }
      return tokens;
    },
  );

  app.post(
    "/api/auth/logout",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["auth"],
        summary: "현재 세션 로그아웃",
        description:
          "현재 access token의 서버 세션을 폐기합니다. 이후 같은 access token과 refresh token은 거절됩니다.",
        security: [{ bearerAuth: [] }],
        response: {
          204: { description: "로그아웃 완료", type: "null" },
          401: unauthenticatedResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      await getAuth().logout(request.auth!.sessionId);
      return reply.code(204).send();
    },
  );
}
