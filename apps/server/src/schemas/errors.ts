/**
 * 공통 오류 본문 `{ error: { code, message, details? } }`의 응답 스키마를 만듭니다(contracts.md 11장).
 *
 * @param description - Swagger에 표시할 상황 설명
 * @param codes - 이 응답에서 나올 수 있는 `error.code` 값
 */
export function errorSchema(description: string, codes: string[]) {
  return {
    description,
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: {
          code: { type: "string", enum: codes },
          message: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
        required: ["code", "message"],
      },
    },
    required: ["error"],
  };
}

/** {@link errorSchema} 형식의 오류 본문을 만듭니다. `details`가 필요하면 직접 구성합니다. */
export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const unauthenticatedResponse = errorSchema(
  "토큰 없음·만료·위조 또는 폐기·만료된 세션",
  ["UNAUTHENTICATED"],
);

/**
 * 본문 해석 단계의 오류 응답입니다.
 *
 * @remarks Fastify는 보낸 POST/PATCH 본문을 본문이 필요 없는 route에서도 해석하므로, 그런 route에도 선언합니다.
 */
export const parseErrorResponses = {
  400: errorSchema("JSON 본문을 해석할 수 없음", ["BAD_REQUEST"]),
  413: errorSchema("본문 크기 제한(1 MiB) 초과", ["PAYLOAD_TOO_LARGE"]),
  415: errorSchema("JSON이 아닌 Content-Type", ["UNSUPPORTED_MEDIA_TYPE"]),
};

/** JSON 본문을 받는 route가 handler 실행 전에 낼 수 있는 오류 응답입니다. */
export const bodyErrorResponses = {
  ...parseErrorResponses,
  422: errorSchema("필드 형식·범위 검증 실패", ["VALIDATION_ERROR"]),
};

export const serverErrorResponses = {
  500: errorSchema("예상하지 못한 서버 오류", ["INTERNAL_ERROR"]),
  503: errorSchema("DB 미설정·연결 실패 등 의존 서비스 장애", [
    "SERVICE_UNAVAILABLE",
  ]),
};

export const rateLimitResponse = errorSchema("요청 과다", ["RATE_LIMITED"]);
