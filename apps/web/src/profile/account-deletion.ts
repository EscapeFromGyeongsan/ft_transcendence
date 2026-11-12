import type { DeleteAccountInput } from "../api/auth-client.ts";
import { ApiError } from "../api/errors.ts";

/** 탈퇴한 사용자의 닉네임 뒤에 붙이는 표시 문구 (AT-17, DATA-05). */
export const DELETED_USER_LABEL = "(탈퇴한 사용자)";

/** 서버 요청 스키마(`DELETE /api/users/me`)와 같은 입력 길이 제한입니다. */
export const DELETE_PASSWORD_MAX_LENGTH = 128;
export const DELETE_CODE_MAX_LENGTH = 32;

/**
 * 본인 확인 방법.
 *
 * `GET /api/users/me`가 비밀번호 보유 여부를 알려주지 않으므로 사용자가 직접 고릅니다.
 * - `password`: 비밀번호 계정
 * - `oauth`: 비밀번호가 없는 42 계정 (2FA 코드, 없으면 최근 로그인)
 */
export type DeleteVerifyMethod = "password" | "oauth";

export interface DeleteAccountFormValues {
  method: DeleteVerifyMethod;
  password: string;
  code: string;
  twoFactorEnabled: boolean;
}

/** 전적 표에 표시할 상대 이름과 링크 가능 여부입니다. */
export function describeOpponent(opponent: {
  id: number;
  nickname: string;
  deleted?: boolean;
}): { label: string; linkable: boolean } {
  if (opponent.deleted === true) {
    return {
      label: `${opponent.nickname} ${DELETED_USER_LABEL}`,
      linkable: false,
    };
  }
  return { label: opponent.nickname, linkable: true };
}

/**
 * 선택한 본인 확인 방법에서 요청 본문을 만듭니다.
 *
 * 선택하지 않은 방법의 값은 보내지 않습니다. 서버는 비밀번호가 있는 계정이면 `code`를 무시하므로
 * 두 값을 함께 보내면 복구 코드가 소모되지는 않지만, 의도하지 않은 값이 서버 로그·요청에 남지 않게 합니다.
 * 비밀번호는 공백도 비밀번호의 일부라 다듬지 않고, 코드는 앞뒤 공백만 제거합니다.
 */
export function buildDeleteAccountInput(
  values: DeleteAccountFormValues,
): DeleteAccountInput {
  if (values.method === "password") {
    return { password: values.password };
  }
  const code = values.code.trim();
  return code.length > 0 ? { code } : {};
}

/** 제출 전에 막을 수 있는 입력 문제의 안내 문구를 반환합니다. 없으면 `null`. */
export function validateDeleteAccountForm(
  values: DeleteAccountFormValues,
): { field: "password" | "code"; message: string } | null {
  if (values.method === "password") {
    if (values.password.length === 0) {
      return { field: "password", message: "비밀번호를 입력해 주세요." };
    }
    if (values.password.length > DELETE_PASSWORD_MAX_LENGTH) {
      return {
        field: "password",
        message: `비밀번호는 ${DELETE_PASSWORD_MAX_LENGTH}자 이하입니다.`,
      };
    }
    return null;
  }
  const code = values.code.trim();
  if (values.twoFactorEnabled && code.length === 0) {
    return {
      field: "code",
      message: "2단계 인증 코드 또는 복구 코드를 입력해 주세요.",
    };
  }
  if (code.length > DELETE_CODE_MAX_LENGTH) {
    return {
      field: "code",
      message: `코드는 ${DELETE_CODE_MAX_LENGTH}자 이하입니다.`,
    };
  }
  return null;
}

/**
 * 탈퇴 실패의 종류.
 *
 * - `password`·`code`: 해당 입력란 오류 (대화상자 유지, 다시 입력)
 * - `relogin`: 최근 로그인 필요 (다시 로그인하도록 안내)
 * - `active-match`: 진행 중·대기 중 경기가 있음 (경기 종료 후 재시도)
 * - `session`: 세션이 끝났거나 이미 탈퇴한 계정 (로그인 화면으로 이동)
 * - `unknown-result`: 응답을 받지 못해 탈퇴 처리 여부를 알 수 없음
 * - `general`: 그 밖의 오류 (대화상자 유지, 재시도 가능)
 */
export type DeleteFailureKind =
  | "password"
  | "code"
  | "relogin"
  | "active-match"
  | "session"
  | "unknown-result"
  | "general";

export interface DeleteFailure {
  kind: DeleteFailureKind;
  message: string;
}

/**
 * 탈퇴 API 오류를 화면 분기와 안내 문구로 바꿉니다 (#89 계약).
 *
 * @remarks
 * 분기는 표시용 `message`가 아니라 상태 코드와 `error.code`로만 합니다. 이 화면에서는 `INVALID_CREDENTIALS`가
 * "이메일 또는 비밀번호"가 아니라 비밀번호 확인 실패이므로 공용 문구(`getErrorMessage`)를 쓰지 않습니다.
 *
 * @param method - 사용자가 고른 본인 확인 방법. 서버가 다른 방법을 요구할 때 안내를 바꾸는 데 씁니다.
 */
export function describeDeleteAccountError(
  error: unknown,
  method: DeleteVerifyMethod,
): DeleteFailure {
  if (!(error instanceof ApiError)) {
    return {
      kind: "unknown-result",
      message:
        "서버 응답을 받지 못해 탈퇴가 처리되었는지 알 수 없습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요. 계속 실패하면 새로고침하거나 다시 로그인해 처리 여부를 확인해 주세요.",
    };
  }

  switch (error.status) {
    case 400:
      if (error.code === "INVALID_CREDENTIALS") {
        return method === "password"
          ? {
              kind: "password",
              message: "비밀번호가 올바르지 않습니다. 다시 확인해 주세요.",
            }
          : {
              kind: "general",
              message:
                "이 계정은 비밀번호로 본인 확인이 필요합니다. '비밀번호' 방법을 선택해 입력해 주세요.",
            };
      }
      if (error.code === "INVALID_TWO_FACTOR_CODE") {
        return method === "oauth"
          ? {
              kind: "code",
              message:
                "2단계 인증 코드 또는 복구 코드가 올바르지 않습니다. 다시 확인해 주세요.",
            }
          : {
              kind: "general",
              message:
                "이 계정은 비밀번호가 없습니다. '42 계정' 방법을 선택해 2단계 인증 코드를 입력해 주세요.",
            };
      }
      return {
        kind: "general",
        message: "요청 형식이 올바르지 않습니다. 입력값을 확인해 주세요.",
      };
    case 401:
      return {
        kind: "session",
        message:
          "로그인 세션이 끝났거나 이미 탈퇴 처리된 계정입니다. 로그인 화면으로 이동합니다.",
      };
    case 403:
      return {
        kind: "relogin",
        message:
          "보안을 위해 최근 10분 안에 로그인한 42 계정만 탈퇴할 수 있습니다. 다시 로그인한 뒤 바로 탈퇴해 주세요.",
      };
    case 409:
      return {
        kind: "active-match",
        message:
          "진행 중이거나 대기 중인 경기가 있어 탈퇴할 수 없습니다. 경기를 마친 뒤 다시 시도해 주세요.",
      };
    case 422:
      return {
        kind: "general",
        message: `입력값을 다시 확인해 주세요. (비밀번호 ${DELETE_PASSWORD_MAX_LENGTH}자, 코드 ${DELETE_CODE_MAX_LENGTH}자 이하)`,
      };
    case 429:
      return {
        kind: "general",
        message:
          "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요. 이전 시도는 실패해 계정은 그대로입니다.",
      };
    default:
      return {
        kind: "general",
        message:
          error.status >= 500
            ? "서버 오류로 탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속 실패하면 다시 로그인해 처리 여부를 확인해 주세요."
            : "탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      };
  }
}
