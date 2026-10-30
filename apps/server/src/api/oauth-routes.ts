import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth-service.ts";
import type { OAuthService } from "../services/oauth-service.ts";
import {
  bodyErrorResponses,
  parseErrorResponses,
  errorBody,
  errorSchema,
  rateLimitResponse,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";
import {
  authRateLimit,
  createRequireAuth,
  tokenPairSchema,
  twoFactorChallengeSchema,
} from "./auth-routes.ts";

const authorizeUrlSchema = {
  description:
    "브라우저를 authorizeUrl로 이동시킵니다(state 10분 유효). flowToken은 이 브라우저의 sessionStorage에 보관했다가 callback에 같이 보냅니다.",
  type: "object",
  properties: {
    authorizeUrl: { type: "string" },
    flowToken: { type: "string" },
  },
  required: ["authorizeUrl", "flowToken"],
};
const providerError = errorSchema("42 API 연결 실패 또는 예상하지 못한 응답", [
  "OAUTH_PROVIDER_ERROR",
]);

const messages: Record<string, [number, string]> = {
  OAUTH_STATE_INVALID: [
    401,
    "OAuth state is invalid, expired or already used.",
  ],
  OAUTH_FAILED: [401, "42 rejected the authorization code."],
  UNAUTHENTICATED: [401, "The session that started linking has ended."],
  EMAIL_TAKEN: [
    409,
    "This email already has an account. Log in and link 42 from settings.",
  ],
  OAUTH_ACCOUNT_LINKED: [409, "This 42 account is linked to another user."],
  OAUTH_ALREADY_LINKED: [
    409,
    "Your account is already linked to a 42 account.",
  ],
  OAUTH_EMAIL_MISSING: [422, "42 did not provide an email address."],
};

export function registerOAuthRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getOAuth: () => OAuthService,
) {
  const requireAuth = createRequireAuth(getAuth);

  app.post(
    "/api/auth/oauth/42/login",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "42 로그인 시작",
        description:
          "처음 로그인하는 42 계정은 새 계정을 만듭니다. 같은 이메일의 기존 계정이 있으면 자동으로 연결하지 않고 409를 반환합니다.",
        response: {
          200: authorizeUrlSchema,
          ...parseErrorResponses,
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async () => getOAuth().startLogin(),
  );

  app.post(
    "/api/auth/oauth/42/link",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["auth"],
        summary: "로그인한 계정에 42 계정 연결 시작",
        security: [{ bearerAuth: [] }],
        response: {
          200: authorizeUrlSchema,
          ...parseErrorResponses,
          401: unauthenticatedResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request) =>
      getOAuth().startLink(request.auth!.userId, request.auth!.sessionId),
  );

  app.post<{ Body: { code: string; state: string; flowToken: string } }>(
    "/api/auth/oauth/42/callback",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "42 인증 결과 처리",
        description:
          "redirect 페이지가 받은 code, state와 시작할 때 보관한 flowToken을 보냅니다. 로그인 시작이면 토큰(또는 2FA challenge), 연결 시작이면 {linked: true}를 반환합니다. state는 시작한 브라우저(flowToken 일치)에서 1회만 사용할 수 있습니다.",
        body: {
          type: "object",
          properties: {
            code: { type: "string", minLength: 1, maxLength: 512 },
            state: { type: "string", minLength: 1, maxLength: 128 },
            flowToken: { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["code", "state", "flowToken"],
          additionalProperties: false,
        },
        response: {
          200: {
            description: "로그인 완료, 2FA 필요, 또는 연결 완료",
            anyOf: [
              tokenPairSchema,
              twoFactorChallengeSchema,
              {
                type: "object",
                properties: { linked: { type: "boolean", const: true } },
                required: ["linked"],
              },
            ],
          },
          ...bodyErrorResponses,
          401: errorSchema(
            "state 무효·만료·재사용·다른 브라우저, 42가 code 거절, 또는 연결을 시작한 세션 종료",
            ["OAUTH_STATE_INVALID", "OAUTH_FAILED", "UNAUTHENTICATED"],
          ),
          409: errorSchema("기존 계정과 이메일 중복 또는 연결 충돌", [
            "EMAIL_TAKEN",
            "OAUTH_ACCOUNT_LINKED",
            "OAUTH_ALREADY_LINKED",
          ]),
          422: errorSchema("필드 검증 실패 또는 42 계정에 이메일 없음", [
            "VALIDATION_ERROR",
            "OAUTH_EMAIL_MISSING",
          ]),
          429: rateLimitResponse,
          ...serverErrorResponses,
          502: providerError,
        },
      },
    },
    async (request, reply) => {
      const result = await getOAuth().callback(
        request.body.code,
        request.body.state,
        request.body.flowToken,
      );
      if (!result.ok) {
        const [status, message] = messages[result.code];
        return reply.code(status).send(errorBody(result.code, message));
      }
      return result.mode === "link" ? { linked: true } : result.login;
    },
  );
}
