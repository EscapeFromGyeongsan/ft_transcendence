/**
 * 서버 검증 오류의 필드 경로와 메시지를 나타내는 단일 항목입니다.
 */
export interface ValidationIssue {
  path: string;
  message?: string;
}

export interface ServerErrorPayload {
  error: {
    code: string;
    message: string;
    details?: {
      issues?: ValidationIssue[];
      [key: string]: unknown;
    };
  };
}

/**
 * API 요청 실패 시 발생하는 구조화된 오류입니다.
 *
 * @remarks
 * 화면 분기와 사용자 안내 문구 선택은 표시용 `serverMessage`가 아니라
 * 항상 `code`(`error.code`)를 기준으로 처리합니다.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly serverMessage: string;
  readonly details?: {
    issues?: ValidationIssue[];
    [key: string]: unknown;
  };

  constructor(
    status: number,
    code: string,
    serverMessage: string,
    details?: { issues?: ValidationIssue[]; [key: string]: unknown },
  ) {
    super(serverMessage);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
    this.details = details;
  }
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  EMAIL_TAKEN: "이미 등록된 이메일입니다.",
  NICKNAME_TAKEN: "이미 사용 중인 닉네임입니다.",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호가 맞지 않습니다.",
  UNAUTHENTICATED:
    "로그인이 필요하거나 세션이 만료되었습니다. 다시 로그인해 주세요.",
  INVALID_TWO_FACTOR_CODE: "인증 코드가 일치하지 않습니다. 다시 확인해 주세요.",
  TWO_FACTOR_ALREADY_ENABLED: "이미 2단계 인증이 활성화되어 있습니다.",
  TWO_FACTOR_NOT_SET_UP: "먼저 2단계 인증 설정을 시작해 주세요.",
  TWO_FACTOR_NOT_ENABLED: "2단계 인증이 활성화되어 있지 않습니다.",
  OAUTH_STATE_INVALID:
    "인증 요청이 만료되었거나 유효하지 않습니다. 다시 시도해 주세요.",
  OAUTH_FAILED: "42 계정 인증에 실패했습니다.",
  OAUTH_ACCOUNT_LINKED:
    "해당 42 계정은 이미 다른 사용자에게 연결되어 있습니다.",
  OAUTH_ALREADY_LINKED: "이미 42 계정이 연결되어 있습니다.",
  OAUTH_EMAIL_MISSING: "42 계정에서 이메일 정보를 확인할 수 없습니다.",
  OAUTH_PROVIDER_ERROR: "현재 42 로그인 서비스를 이용할 수 없습니다.",
  BAD_REQUEST: "요청 형식이 올바르지 않습니다.",
  PAYLOAD_TOO_LARGE: "요청 데이터 크기가 제한을 초과했습니다.",
  UNSUPPORTED_MEDIA_TYPE: "지원하지 않는 데이터 형식입니다.",
  NOT_FOUND: "요청한 정보를 찾을 수 없습니다.",
  RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  SERVICE_UNAVAILABLE:
    "서버 또는 데이터베이스에 일시적으로 연결할 수 없습니다.",
  INTERNAL_ERROR: "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

function getValidationIssueMessage(path: string): string | undefined {
  if (path.includes("email")) {
    return "올바른 이메일 주소를 입력해 주세요.";
  }
  if (path.includes("password")) {
    return "비밀번호는 8자 이상 128자 이하로 입력해 주세요.";
  }
  if (path.includes("nickname")) {
    return "닉네임은 2~32자의 문자, 숫자, 밑줄(_), 하이픈(-)만 사용할 수 있습니다.";
  }
  return undefined;
}

/**
 * 오류 객체에서 `error.code`를 기준으로 사용자에게 표시할 안내 문구를 반환합니다.
 *
 * @param error - API 호출 중 발생한 예외
 * @returns 화면에 표시할 한국어 안내 문구 (미등록 코드인 경우 서버의 표시용 `message` 반환)
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "VALIDATION_ERROR") {
      const issues = error.details?.issues;
      if (Array.isArray(issues) && issues.length > 0) {
        const firstIssue = issues[0];
        const fieldMsg = getValidationIssueMessage(firstIssue.path ?? "");
        if (fieldMsg) return fieldMsg;
      }
      return "입력값을 다시 확인해 주세요.";
    }

    const mapped = ERROR_CODE_MESSAGES[error.code];
    if (mapped) {
      return mapped;
    }

    if (error.serverMessage.trim().length > 0) {
      return error.serverMessage;
    }
    return "요청을 처리하는 중 오류가 발생했습니다.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return "네트워크 연결을 확인하고 다시 시도해 주세요.";
  }

  return "요청을 처리하는 중 알 수 없는 오류가 발생했습니다.";
}

export interface AuthFieldErrors {
  email?: string;
  password?: string;
  nickname?: string;
}

/**
 * `error.code`와 검증 세부 정보(`details.issues`)를 기준으로 입력 필드별 오류 메시지를 추출합니다.
 *
 * @param error - API 호출 중 발생한 예외
 * @returns 이메일·비밀번호·닉네임 필드별 오류 메시지
 */
export function getAuthFieldErrors(error: unknown): AuthFieldErrors {
  if (!(error instanceof ApiError)) {
    return {};
  }

  if (error.code === "EMAIL_TAKEN") {
    return { email: ERROR_CODE_MESSAGES.EMAIL_TAKEN };
  }

  if (error.code === "NICKNAME_TAKEN") {
    return { nickname: ERROR_CODE_MESSAGES.NICKNAME_TAKEN };
  }

  if (error.code === "VALIDATION_ERROR") {
    const fieldErrors: AuthFieldErrors = {};
    const issues = error.details?.issues ?? [];
    for (const issue of issues) {
      const path = issue.path ?? "";
      if (path.includes("email") && !fieldErrors.email) {
        fieldErrors.email =
          getValidationIssueMessage("email") ?? "이메일 형식을 확인해 주세요.";
      } else if (path.includes("password") && !fieldErrors.password) {
        fieldErrors.password =
          getValidationIssueMessage("password") ?? "비밀번호를 확인해 주세요.";
      } else if (path.includes("nickname") && !fieldErrors.nickname) {
        fieldErrors.nickname =
          getValidationIssueMessage("nickname") ?? "닉네임을 확인해 주세요.";
      }
    }
    return fieldErrors;
  }

  return {};
}

/**
 * 응답 JSON이 서버 표준 오류 형식(`{ error: { code, message } }`)인지 판별합니다.
 */
export function isServerErrorPayload(
  value: unknown,
): value is ServerErrorPayload {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  const message = (err as { message?: unknown }).message;
  return typeof code === "string" && typeof message === "string";
}
