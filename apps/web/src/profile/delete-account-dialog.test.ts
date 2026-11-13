import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeleteAccountDialog } from "./DeleteAccountDialog.tsx";

const callbacks = {
  nickname: "tester",
  onClose() {},
  onDeleted() {},
  onSessionEnded() {},
  onRequireRelogin() {},
};

describe("탈퇴 본인 확인 입력 (#89 hasPassword)", () => {
  it("비밀번호 계정은 2FA를 켰어도 비밀번호만 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteAccountDialog, {
        ...callbacks,
        hasPassword: true,
        twoFactorEnabled: true,
      }),
    );
    expect(html).toContain('data-testid="delete-account-password"');
    expect(html).not.toContain('data-testid="delete-account-code"');
    expect(html).not.toContain('name="delete-verify-method"');
  });

  it("비밀번호 없는 42 계정은 2FA 코드만 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteAccountDialog, {
        ...callbacks,
        hasPassword: false,
        twoFactorEnabled: true,
      }),
    );
    expect(html).toContain('data-testid="delete-account-code"');
    expect(html).not.toContain('data-testid="delete-account-password"');
    expect(html).not.toContain('name="delete-verify-method"');
  });

  it("2FA 없는 42 계정은 입력란 대신 최근 로그인 조건을 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteAccountDialog, {
        ...callbacks,
        hasPassword: false,
        twoFactorEnabled: false,
      }),
    );
    expect(html).not.toContain('data-testid="delete-account-password"');
    expect(html).not.toContain('data-testid="delete-account-code"');
    expect(html).toContain("최근 10분");
  });

  it("이전 서버처럼 비밀번호 유무를 모르면 확인 방법을 선택할 수 있다", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteAccountDialog, {
        ...callbacks,
        twoFactorEnabled: false,
      }),
    );
    expect(html).toContain('data-testid="delete-method-password"');
    expect(html).toContain('data-testid="delete-method-oauth"');
  });

  it("2FA 상태 조회가 끝나지 않았으면 코드 입력 수단을 유지한다", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteAccountDialog, { ...callbacks, hasPassword: false }),
    );
    expect(html).toContain('data-testid="delete-account-code"');
    expect(html).toContain("2FA를 쓰지 않으면 비워 두세요");
  });
});
