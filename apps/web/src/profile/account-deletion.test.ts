import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AccountDeletionDialog,
  type AccountDeletionDialogProps,
} from "./AccountDeletionDialog.tsx";
import { MatchOpponent } from "./ProfileView.tsx";

function renderDialog(overrides: Partial<AccountDeletionDialogProps> = {}) {
  return renderToStaticMarkup(
    createElement(AccountDeletionDialog, {
      twoFactorEnabled: false,
      submitting: false,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
      ...overrides,
    }),
  );
}

describe("회원 탈퇴 대화상자 (#85)", () => {
  it("되돌릴 수 없음과 삭제·보존 항목을 안내하는 modal dialog를 그린다", () => {
    const html = renderDialog();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="account-deletion-title"');
    expect(html).toContain("탈퇴는 되돌릴 수 없습니다");
    expect(html).toContain("즉시 삭제");
    expect(html).toContain("계속 보존");
    expect(html).toContain('id="account-deletion-password"');
    expect(html).toContain('type="password"');
  });

  it("2FA가 켜진 계정에만 인증 코드 입력란을 표시한다", () => {
    expect(renderDialog()).not.toContain("account-deletion-code-input");
    expect(renderDialog()).toContain("10분 안에만 탈퇴할 수 있습니다");
    const html = renderDialog({ twoFactorEnabled: true });
    expect(html).toContain("account-deletion-code-input");
    expect(html).toContain("2단계 인증 코드 또는 복구 코드");
  });

  it("비밀번호 계정은 2FA가 켜져 있어도 비밀번호 입력란만 보여준다", () => {
    const html = renderDialog({ hasPassword: true, twoFactorEnabled: true });
    expect(html).toContain('id="account-deletion-password"');
    expect(html).not.toContain("account-deletion-code-input");
    expect(html).not.toContain("42 계정으로 가입해");
  });

  it("42 전용 계정은 비밀번호 입력란 없이 2FA 코드 또는 최근 로그인 안내를 보여준다", () => {
    const withCode = renderDialog({
      hasPassword: false,
      twoFactorEnabled: true,
    });
    expect(withCode).not.toContain('id="account-deletion-password"');
    expect(withCode).toContain("account-deletion-code-input");
    const recent = renderDialog({ hasPassword: false });
    expect(recent).not.toContain('id="account-deletion-password"');
    expect(recent).not.toContain("account-deletion-code-input");
    expect(recent).toContain("account-deletion-recent-login");
  });

  it("요청 중에는 입력과 버튼을 비활성화하고 진행 문구를 보여준다", () => {
    const html = renderDialog({ twoFactorEnabled: true, submitting: true });
    expect(html).toContain("탈퇴 처리 중...");
    const disabled = html.match(/<(input|button)[^>]*disabled=""/g) ?? [];
    expect(disabled).toHaveLength(4);
  });

  it("오류 문구를 alert로 표시한다", () => {
    const html = renderDialog({ error: "비밀번호가 맞지 않습니다." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("비밀번호가 맞지 않습니다.");
  });
});

describe("전적의 탈퇴한 상대 표시 (#85)", () => {
  it("탈퇴한 상대는 (탈퇴한 사용자)를 붙이고 프로필 링크 버튼을 만들지 않는다", () => {
    const html = renderToStaticMarkup(
      createElement(MatchOpponent, {
        opponent: { id: 3, nickname: "alex", deleted: true },
        onOpenProfile: () => {},
      }),
    );
    expect(html).toContain("alex (탈퇴한 사용자)");
    expect(html).not.toContain("<button");
  });

  it("활성 상대는 닉네임만 표시하고 프로필 버튼을 만든다", () => {
    const html = renderToStaticMarkup(
      createElement(MatchOpponent, {
        opponent: { id: 3, nickname: "alex", deleted: false },
        onOpenProfile: () => {},
      }),
    );
    expect(html).toContain("<button");
    expect(html).toContain("alex");
    expect(html).not.toContain("탈퇴한 사용자");
  });
});
