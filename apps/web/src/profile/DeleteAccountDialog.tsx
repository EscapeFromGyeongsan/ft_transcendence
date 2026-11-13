import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { authApi, type AuthApiClient } from "../api/auth-client.ts";
import {
  DELETE_CODE_MAX_LENGTH,
  DELETE_PASSWORD_MAX_LENGTH,
  DELETED_USER_LABEL,
  buildDeleteAccountInput,
  describeDeleteAccountError,
  validateDeleteAccountForm,
  type DeleteFailure,
  type DeleteVerifyMethod,
} from "./account-deletion.ts";

/** 계정의 본인 확인 수단과 탈퇴 결과에 따른 화면 전환을 전달합니다. */
interface DeleteAccountDialogProps {
  nickname: string;
  hasPassword?: boolean;
  /** 2FA를 사용 중이면 42 계정 방법에서 코드가 필수입니다. */
  twoFactorEnabled?: boolean;
  authClient?: AuthApiClient;
  /** 취소(버튼·Escape·바깥 클릭). 호출한 쪽이 열기 버튼으로 포커스를 돌려줍니다. */
  onClose: () => void;
  /** 탈퇴 성공. 토큰은 이미 지워진 상태이며 호출한 쪽이 화면을 이동합니다. */
  onDeleted: () => void;
  /** 401: 세션이 끝났거나 이미 탈퇴한 계정. */
  onSessionEnded: () => void;
  /** 403: 다시 로그인하러 이동. */
  onRequireRelogin: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * 회원 탈퇴 확인 대화상자 (AT-17, DEC-09, #89 `DELETE /api/users/me`).
 *
 * 되돌릴 수 없다는 안내와 본인 확인을 한 화면에서 받습니다. 열리면 첫 입력란에 포커스가 가고,
 * Tab은 대화상자 안에서만 돌며, 요청 중에는 닫을 수 없습니다.
 */
export function DeleteAccountDialog({
  nickname,
  hasPassword,
  twoFactorEnabled,
  authClient = authApi,
  onClose,
  onDeleted,
  onSessionEnded,
  onRequireRelogin,
}: DeleteAccountDialogProps) {
  const [selectedMethod, setMethod] = useState<DeleteVerifyMethod>("password");
  const method =
    hasPassword === undefined
      ? selectedMethod
      : hasPassword
        ? "password"
        : "oauth";
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeRequired, setCodeRequired] = useState(false);
  const requiresCode = twoFactorEnabled === true || codeRequired;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DeleteFailure | null>(null);
  const [validation, setValidation] = useState<{
    field: "password" | "code";
    message: string;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const reloginRef = useRef<HTMLButtonElement | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 확인 수단이 조회되면 첫 입력란으로, 입력이 없으면 취소 버튼으로 이동합니다.
  useEffect(() => {
    (passwordRef.current ?? codeRef.current ?? cancelRef.current)?.focus();
  }, [hasPassword, twoFactorEnabled]);

  // 비활성화가 해제된 렌더 이후에 입력 오류의 포커스를 복구합니다.
  useEffect(() => {
    if (busy) {
      dialogRef.current?.focus();
      return;
    }
    if (!failure) return;
    const target =
      failure.kind === "password"
        ? passwordRef
        : failure.kind === "code"
          ? codeRef
          : failure.kind === "relogin"
            ? reloginRef
            : confirmRef;
    target.current?.focus();
  }, [busy, failure]);

  // 방법을 바꾸면 이전 입력과 오류를 지웁니다. 포커스는 라디오에 둬 방향키 조작을 이어갑니다.
  function selectMethod(next: DeleteVerifyMethod) {
    if (busy || next === method) return;
    setMethod(next);
    setFailure(null);
    setValidation(null);
    setPassword("");
    setCode("");
  }

  function requestClose() {
    if (busyRef.current) return;
    onClose();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    // 같은 이름의 라디오 그룹에서는 선택된 항목만 Tab 정지점입니다. 선택되지 않은 라디오를
    // 처음·끝 후보에 넣으면 Shift+Tab이 대화상자 밖으로 새므로 제외합니다.
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter(
      (element) =>
        !element.matches(":disabled") &&
        !(
          element instanceof HTMLInputElement &&
          element.type === "radio" &&
          !element.checked
        ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = globalThis.document.activeElement;
    if (
      event.shiftKey &&
      (active === first || !dialogRef.current?.contains(active))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (active === last || active === dialogRef.current)
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const values = {
      method,
      password,
      code,
      twoFactorEnabled: requiresCode,
    };
    const invalid = validateDeleteAccountForm(values);
    setFailure(null);
    setValidation(invalid);
    if (invalid) {
      (invalid.field === "password" ? passwordRef : codeRef).current?.focus();
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      await authClient.deleteAccount(buildDeleteAccountInput(values));
    } catch (error) {
      busyRef.current = false;
      if (!mountedRef.current) return;
      setBusy(false);
      const described = describeDeleteAccountError(error, method);
      if (described.kind === "session") {
        onSessionEnded();
        return;
      }
      setFailure(described);
      // 입력 오류는 해당 입력란으로 돌아가 바로 고칠 수 있게 합니다.
      if (described.kind === "password") {
        setPassword("");
      } else if (described.kind === "code") {
        // 다른 기기에서 2FA를 켰다면 서버 응답을 기준으로 코드 입력을 엽니다.
        setCodeRequired(true);
        setCode("");
      }
      return;
    }
    busyRef.current = false;
    onDeleted();
  }

  const passwordError =
    validation?.field === "password"
      ? validation.message
      : failure?.kind === "password"
        ? failure.message
        : null;
  const codeError =
    validation?.field === "code"
      ? validation.message
      : failure?.kind === "code"
        ? failure.message
        : null;
  const generalFailure =
    failure && failure.kind !== "password" && failure.kind !== "code"
      ? failure
      : null;

  return (
    <div
      className="cbc-modal-backdrop"
      data-testid="delete-account-backdrop"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-desc"
        className="cbc-modal-dialog cbc-delete-dialog"
        data-testid="delete-account-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="cbc-modal-alert-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
        </div>
        <h3 id="delete-account-title" className="cbc-delete-title">
          정말 회원 탈퇴할까요?
        </h3>
        <div id="delete-account-desc" className="cbc-delete-desc">
          <p>
            <strong>{nickname}</strong> 계정을 탈퇴하면{" "}
            <strong>되돌릴 수 없습니다.</strong>
          </p>
          <ul>
            <li>
              이메일, 비밀번호, 42 계정 연동, 2단계 인증 정보가 삭제되고 모든
              기기에서 로그아웃됩니다.
            </li>
            <li>
              경기 결과와 경기 당시 닉네임은 남아 상대방의 전적에{" "}
              <em>{DELETED_USER_LABEL}</em>로 표시됩니다. 내 프로필과
              리더보드에서는 사라집니다.
            </li>
            <li>
              같은 이메일·닉네임으로 다시 가입할 수 있지만 이전 전적은 이어지지
              않습니다.
            </li>
            <li>진행 중이거나 대기 중인 경기가 있으면 탈퇴할 수 없습니다.</li>
          </ul>
        </div>

        <form
          className="flex flex-col gap-5 cbc-delete-form"
          onSubmit={handleSubmit}
          noValidate
        >
          {hasPassword === undefined && (
            <fieldset className="cbc-delete-methods" disabled={busy}>
              <legend className="text-sm/5 font-semibold tracking-[0.01em] text-on-surface">
                본인 확인 방법
              </legend>
              <label className="cbc-delete-method">
                <input
                  type="radio"
                  name="delete-verify-method"
                  checked={method === "password"}
                  onChange={() => selectMethod("password")}
                  data-testid="delete-method-password"
                />
                <span>비밀번호로 확인</span>
              </label>
              <label className="cbc-delete-method">
                <input
                  type="radio"
                  name="delete-verify-method"
                  checked={method === "oauth"}
                  onChange={() => selectMethod("oauth")}
                  data-testid="delete-method-oauth"
                />
                <span>비밀번호 없는 42 계정</span>
              </label>
            </fieldset>
          )}

          {method === "password" ? (
            <div className="flex flex-col gap-1.5">
              <label
                className="text-sm/5 font-semibold tracking-[0.01em] text-on-surface"
                htmlFor="delete-account-password"
              >
                비밀번호
              </label>
              <input
                ref={passwordRef}
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                className={`cbc-input ${passwordError ? "is-error" : ""}`}
                data-testid="delete-account-password"
                value={password}
                maxLength={DELETE_PASSWORD_MAX_LENGTH}
                disabled={busy}
                aria-invalid={Boolean(passwordError)}
                aria-describedby={
                  passwordError ? "delete-account-password-error" : undefined
                }
                onChange={(event) => {
                  setPassword(event.target.value);
                  setValidation(null);
                  if (failure?.kind === "password") setFailure(null);
                }}
              />
              {passwordError && (
                <p
                  id="delete-account-password-error"
                  className="cbc-field-error"
                  role="alert"
                >
                  {passwordError}
                </p>
              )}
            </div>
          ) : requiresCode ||
            twoFactorEnabled !== false ||
            hasPassword === undefined ? (
            <div className="flex flex-col gap-1.5">
              <label
                className="text-sm/5 font-semibold tracking-[0.01em] text-on-surface"
                htmlFor="delete-account-code"
              >
                2단계 인증 코드 또는 복구 코드
                {requiresCode ? "" : " (2FA를 쓰는 경우만)"}
              </label>
              <input
                ref={codeRef}
                id="delete-account-code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="6자리 숫자 또는 ABCD-EFGH"
                className={`cbc-input ${codeError ? "is-error" : ""}`}
                data-testid="delete-account-code"
                value={code}
                maxLength={DELETE_CODE_MAX_LENGTH}
                disabled={busy}
                aria-invalid={Boolean(codeError)}
                aria-describedby={
                  codeError
                    ? "delete-account-code-error"
                    : "delete-account-code-hint"
                }
                onChange={(event) => {
                  setCode(event.target.value);
                  setValidation(null);
                  if (failure?.kind === "code") setFailure(null);
                }}
              />
              {codeError ? (
                <p
                  id="delete-account-code-error"
                  className="cbc-field-error"
                  role="alert"
                >
                  {codeError}
                </p>
              ) : (
                <p id="delete-account-code-hint" className="cbc-field-helper">
                  {requiresCode
                    ? "인증 앱의 6자리 코드 또는 사용하지 않은 복구 코드를 입력해 주세요."
                    : "2FA를 쓰지 않으면 비워 두세요. 이 경우 최근 10분 안에 로그인한 계정만 탈퇴할 수 있습니다."}
                </p>
              )}
            </div>
          ) : (
            <p className="cbc-field-helper">
              최근 10분 안에 로그인한 42 계정만 탈퇴할 수 있습니다.
            </p>
          )}

          {generalFailure && (
            <div
              className="cbc-error-banner"
              role="alert"
              data-testid="delete-account-error"
              data-kind={generalFailure.kind}
            >
              <span>{generalFailure.message}</span>
            </div>
          )}
          {generalFailure?.kind === "relogin" && (
            <button
              ref={reloginRef}
              type="button"
              className="cbc-btn-secondary"
              data-testid="delete-account-relogin"
              onClick={onRequireRelogin}
            >
              다시 로그인하기
            </button>
          )}

          <div className="cbc-modal-actions">
            <button
              ref={cancelRef}
              type="button"
              className="cbc-btn-secondary"
              disabled={busy}
              data-testid="delete-account-cancel"
              onClick={requestClose}
            >
              취소
            </button>
            <button
              ref={confirmRef}
              type="submit"
              className="cbc-btn-danger"
              disabled={busy}
              data-testid="delete-account-confirm"
            >
              {busy ? "탈퇴 처리 중..." : "회원 탈퇴"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
