import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors.ts";
import {
  DELETED_USER_LABEL,
  buildDeleteAccountInput,
  describeDeleteAccountError,
  describeOpponent,
  validateDeleteAccountForm,
} from "./account-deletion.ts";

const base = {
  method: "password" as const,
  password: "",
  code: "",
  twoFactorEnabled: false,
};

describe("describeOpponent (탈퇴 사용자 표시)", () => {
  it("탈퇴한 상대는 경기 당시 닉네임 뒤에 (탈퇴한 사용자)를 붙이고 링크하지 않는다", () => {
    expect(
      describeOpponent({ id: 9, nickname: "old_nick", deleted: true }),
    ).toEqual({ label: `old_nick ${DELETED_USER_LABEL}`, linkable: false });
    expect(DELETED_USER_LABEL).toBe("(탈퇴한 사용자)");
  });

  it("탈퇴하지 않은 상대는 닉네임만 보이고 프로필로 연결된다", () => {
    expect(
      describeOpponent({ id: 3, nickname: "alice", deleted: false }),
    ).toEqual({ label: "alice", linkable: true });
  });

  it("deleted 필드가 없으면(이전 서버 응답) 탈퇴자로 오인하지 않는다", () => {
    expect(describeOpponent({ id: 3, nickname: "alice" })).toEqual({
      label: "alice",
      linkable: true,
    });
  });
});

describe("buildDeleteAccountInput", () => {
  it("비밀번호 방법은 비밀번호를 있는 그대로(공백 포함) 보내고 code는 보내지 않는다", () => {
    expect(
      buildDeleteAccountInput({
        ...base,
        password: " pa ss ",
        code: "123456",
      }),
    ).toEqual({ password: " pa ss " });
  });

  it("42 계정 방법은 code만 앞뒤 공백을 제거해 보내고 password는 보내지 않는다", () => {
    expect(
      buildDeleteAccountInput({
        ...base,
        method: "oauth",
        password: "ignored",
        code: "  ABCD-EFGH ",
      }),
    ).toEqual({ code: "ABCD-EFGH" });
  });

  it("42 계정에서 코드가 비어 있으면 빈 입력(최근 로그인 확인)을 만든다", () => {
    expect(
      buildDeleteAccountInput({ ...base, method: "oauth", code: "   " }),
    ).toEqual({});
  });
});

describe("validateDeleteAccountForm", () => {
  it("비밀번호 방법은 빈 비밀번호를 막는다", () => {
    expect(validateDeleteAccountForm(base)).toEqual({
      field: "password",
      message: "비밀번호를 입력해 주세요.",
    });
  });

  it("서버 제한(128자)을 넘는 비밀번호를 막는다", () => {
    expect(
      validateDeleteAccountForm({ ...base, password: "a".repeat(129) }),
    ).toMatchObject({ field: "password" });
    expect(
      validateDeleteAccountForm({ ...base, password: "a".repeat(128) }),
    ).toBeNull();
  });

  it("42 계정은 2FA를 쓰면 코드가 필수이고, 쓰지 않으면 비워도 된다", () => {
    const oauth = { ...base, method: "oauth" as const };
    expect(
      validateDeleteAccountForm({ ...oauth, twoFactorEnabled: true }),
    ).toMatchObject({ field: "code" });
    expect(
      validateDeleteAccountForm({
        ...oauth,
        twoFactorEnabled: true,
        code: "123456",
      }),
    ).toBeNull();
    expect(validateDeleteAccountForm(oauth)).toBeNull();
  });

  it("서버 제한(32자)을 넘는 코드를 막는다", () => {
    expect(
      validateDeleteAccountForm({
        ...base,
        method: "oauth",
        code: "1".repeat(33),
      }),
    ).toMatchObject({ field: "code" });
  });
});

describe("describeDeleteAccountError (#89 계약의 400·401·403·409·422·429·5xx)", () => {
  const api = (status: number, code: string) =>
    new ApiError(status, code, "server message");

  it("400 INVALID_CREDENTIALS: 비밀번호 방법이면 비밀번호란 오류, '이메일 또는' 공용 문구를 쓰지 않는다", () => {
    const failure = describeDeleteAccountError(
      api(400, "INVALID_CREDENTIALS"),
      "password",
    );
    expect(failure.kind).toBe("password");
    expect(failure.message).toContain("비밀번호가 올바르지 않습니다");
    expect(failure.message).not.toContain("이메일");
  });

  it("400 INVALID_CREDENTIALS: 42 방법을 골랐는데 비밀번호 계정이면 방법을 바꾸라고 안내한다", () => {
    const failure = describeDeleteAccountError(
      api(400, "INVALID_CREDENTIALS"),
      "oauth",
    );
    expect(failure.kind).toBe("general");
    expect(failure.message).toContain("비밀번호");
  });

  it("400 INVALID_TWO_FACTOR_CODE: 42 방법이면 코드란 오류", () => {
    expect(
      describeDeleteAccountError(api(400, "INVALID_TWO_FACTOR_CODE"), "oauth")
        .kind,
    ).toBe("code");
  });

  it("400 INVALID_TWO_FACTOR_CODE: 비밀번호 방법을 골랐는데 비밀번호 없는 계정이면 방법을 바꾸라고 안내한다", () => {
    const failure = describeDeleteAccountError(
      api(400, "INVALID_TWO_FACTOR_CODE"),
      "password",
    );
    expect(failure.kind).toBe("general");
    expect(failure.message).toContain("42 계정");
  });

  it("400 BAD_REQUEST는 일반 오류", () => {
    expect(describeDeleteAccountError(api(400, "BAD_REQUEST"), "password").kind).toBe(
      "general",
    );
  });

  it("401은 세션 종료로 분류해 로그인 화면으로 보낸다", () => {
    expect(
      describeDeleteAccountError(api(401, "UNAUTHENTICATED"), "password").kind,
    ).toBe("session");
  });

  it("403 RECENT_LOGIN_REQUIRED는 다시 로그인 안내(10분)", () => {
    const failure = describeDeleteAccountError(
      api(403, "RECENT_LOGIN_REQUIRED"),
      "oauth",
    );
    expect(failure.kind).toBe("relogin");
    expect(failure.message).toContain("10분");
  });

  it("409 ACTIVE_MATCH는 경기 종료 후 재시도 안내", () => {
    const failure = describeDeleteAccountError(
      api(409, "ACTIVE_MATCH"),
      "password",
    );
    expect(failure.kind).toBe("active-match");
    expect(failure.message).toContain("경기");
  });

  it("422·429·5xx는 일반 오류이고 429는 이전 시도가 실패했음을 알린다", () => {
    expect(describeDeleteAccountError(api(422, "VALIDATION_ERROR"), "password").kind).toBe(
      "general",
    );
    const limited = describeDeleteAccountError(api(429, "RATE_LIMITED"), "password");
    expect(limited.kind).toBe("general");
    expect(limited.message).toContain("잠시 후");
    expect(describeDeleteAccountError(api(503, "SERVICE_UNAVAILABLE"), "password").message).toContain(
      "다시 로그인해 처리 여부를 확인",
    );
  });

  it("서버 표시용 message가 아니라 상태 코드·code로 분기한다", () => {
    const misleading = new ApiError(409, "ACTIVE_MATCH", "비밀번호가 올바르지 않습니다.");
    expect(describeDeleteAccountError(misleading, "password").kind).toBe(
      "active-match",
    );
  });

  it("응답을 받지 못한 네트워크 오류는 처리 여부를 알 수 없다고 안내한다", () => {
    const failure = describeDeleteAccountError(
      new TypeError("Failed to fetch"),
      "password",
    );
    expect(failure.kind).toBe("unknown-result");
    expect(failure.message).toContain("알 수 없습니다");
  });
});
