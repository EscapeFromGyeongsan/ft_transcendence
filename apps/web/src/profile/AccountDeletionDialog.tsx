import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AccountDeletionInput } from "../api/profile-api.ts";

/** 회원 탈퇴 확인 대화상자 속성입니다. */
export interface AccountDeletionDialogProps {
  /** 2FA가 켜진 계정이면 2FA 코드 입력란을 함께 표시합니다. */
  twoFactorEnabled: boolean;
  /** 탈퇴 요청 중이면 입력과 버튼을 비활성화하고 Escape·바깥 클릭으로 닫히지 않게 합니다. */
  submitting: boolean;
  error: string | null;
  /** 닫기 요청. 트리거 버튼으로 포커스를 돌려주는 일은 호출한 쪽이 맡습니다. */
  onCancel: () => void;
  onConfirm: (input: AccountDeletionInput) => void;
}

/**
 * 되돌릴 수 없음과 삭제·보존 항목을 안내하고 본인 확인 값을 받아 탈퇴를 요청하는 대화상자입니다 (#85, DEC-09).
 *
 * @remarks
 * 화면은 계정에 비밀번호가 있는지 알 수 없으므로 비밀번호 입력란은 항상 표시하고,
 * 비밀번호가 없는 42 계정은 비워 두도록 안내합니다. 열리면 첫 입력란으로 포커스를 옮기고
 * Escape로 닫습니다 (NFR-UX-02).
 */
export function AccountDeletionDialog({
  twoFactorEnabled,
  submitting,
  error,
  onCancel,
  onConfirm,
}: AccountDeletionDialogProps) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!submitting) onCancel();
      }
    }
    globalThis.window.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.window.removeEventListener("keydown", handleKeyDown);
    };
  }, [submitting, onCancel]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    onConfirm({ password, code });
  }

  return (
    <div
      className="cbc-modal-backdrop"
      data-testid="account-deletion-backdrop"
      onClick={() => {
        if (!submitting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-deletion-title"
        aria-describedby="account-deletion-desc"
        className="cbc-modal-dialog"
        data-testid="account-deletion-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cbc-modal-alert-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
        </div>
        <h3
          id="account-deletion-title"
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "22px",
            margin: "0 0 0.5rem",
          }}
        >
          정말 회원 탈퇴하시겠습니까?
        </h3>
        <p
          id="account-deletion-desc"
          className="cbc-subheading"
          style={{ maxWidth: "360px" }}
        >
          탈퇴는 되돌릴 수 없습니다. 모든 기기에서 로그아웃되며 이 계정으로 다시
          로그인할 수 없습니다.
        </p>

        <div className="cbc-account-deletion-scope">
          <p>
            <strong>즉시 삭제</strong>
            이메일, 비밀번호, 42 계정 연동, 2단계 인증 설정과 복구 코드, 프로필
            이미지
          </p>
          <p>
            <strong>계속 보존</strong>
            경기 결과와 착수 기록, 경기 당시 닉네임. 상대의 전적에는 "닉네임
            (탈퇴한 사용자)"로 표시됩니다.
          </p>
        </div>

        <form
          className="cbc-form"
          style={{ width: "100%", marginTop: "0.75rem", textAlign: "left" }}
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="cbc-field">
            <label className="cbc-label" htmlFor="account-deletion-password">
              비밀번호
            </label>
            <input
              ref={firstInputRef}
              id="account-deletion-password"
              type="password"
              autoComplete="current-password"
              className={`cbc-input ${error ? "is-error" : ""}`}
              data-testid="account-deletion-password-input"
              value={password}
              disabled={submitting}
              aria-describedby="account-deletion-password-help"
              onChange={(e) => setPassword(e.target.value)}
            />
            <p id="account-deletion-password-help" className="cbc-field-helper">
              <span>
                {twoFactorEnabled
                  ? "42 계정으로 가입해 비밀번호가 없다면 비워 두고 아래에 인증 코드를 입력해 주세요."
                  : "42 계정으로 가입해 비밀번호가 없다면 비워 두세요. 이 경우 로그인한 지 10분 안에만 탈퇴할 수 있습니다."}
              </span>
            </p>
          </div>

          {twoFactorEnabled && (
            <div className="cbc-field">
              <label className="cbc-label" htmlFor="account-deletion-code">
                2단계 인증 코드 또는 복구 코드
              </label>
              <input
                id="account-deletion-code"
                type="text"
                autoComplete="one-time-code"
                placeholder="6자리 숫자 또는 ABCD-EFGH"
                className={`cbc-input ${error ? "is-error" : ""}`}
                data-testid="account-deletion-code-input"
                value={code}
                disabled={submitting}
                aria-describedby="account-deletion-code-help"
                onChange={(e) => setCode(e.target.value)}
              />
              <p id="account-deletion-code-help" className="cbc-field-helper">
                <span>
                  비밀번호가 없는 42 계정만 이 코드로 본인을 확인합니다.
                </span>
              </p>
            </div>
          )}

          {error && (
            <div className="cbc-error-banner" role="alert">
              <span>{error}</span>
            </div>
          )}

          <div className="cbc-modal-actions">
            <button
              type="button"
              className="cbc-btn-secondary"
              disabled={submitting}
              onClick={onCancel}
            >
              취소
            </button>
            <button
              type="submit"
              className="cbc-btn-danger"
              disabled={submitting}
              data-testid="confirm-account-deletion-btn"
            >
              <span>{submitting ? "탈퇴 처리 중..." : "회원 탈퇴"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
