// Shared error body: { error: { code, message, details? } } (contracts.md 3장).
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

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const unauthenticatedResponse = errorSchema(
  "토큰 없음·만료·위조 또는 폐기·만료된 세션",
  ["UNAUTHENTICATED"],
);

// Responses any route with a JSON body can hit before the handler runs.
export const bodyErrorResponses = {
  400: errorSchema("JSON 본문을 해석할 수 없음", ["BAD_REQUEST"]),
  415: errorSchema("JSON이 아닌 Content-Type", ["UNSUPPORTED_MEDIA_TYPE"]),
  422: errorSchema("필드 형식·범위 검증 실패", ["VALIDATION_ERROR"]),
};

export const serverErrorResponses = {
  500: errorSchema("예상하지 못한 서버 오류", ["INTERNAL_ERROR"]),
  503: errorSchema("DB 미설정·연결 실패 등 의존 서비스 장애", [
    "SERVICE_UNAVAILABLE",
  ]),
};

export const rateLimitResponse = errorSchema("요청 과다", ["RATE_LIMITED"]);
