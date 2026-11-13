import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  authApi,
  type AuthApiClient,
  type AuthUser,
  type TwoFactorSetupResponse,
} from "../api/auth-client.ts";
import {
  ApiError,
  getAuthFieldErrors,
  getErrorMessage,
} from "../api/errors.ts";
import {
  profileApi,
  type GameStats,
  type GameType,
  type MatchRecord,
  type ProfileApi,
  type PublicProfile,
} from "../api/profile-api.ts";
import {
  GAME_LABELS,
  RESULT_LABELS,
  formatMatchDate,
  formatWinRate,
  sumStats,
  validateAvatarFile,
} from "../api/profile-format.ts";
import { Avatar } from "./Avatar.tsx";
import { DeleteAccountDialog } from "./DeleteAccountDialog.tsx";
import { describeOpponent } from "./account-deletion.ts";

const GAME_TYPES: GameType[] = ["gomoku", "othello"];
const MATCH_PAGE_SIZE = 10;

/** 조회 대상·로그인 사용자와 편집 결과 반영·화면 이동 동작을 받는 프로필 화면 속성입니다. */
interface ProfileViewProps {
  /** 조회할 사용자 ID. 로그인한 본인의 ID이면 편집 가능한 "내 프로필"로 표시합니다. */
  userId: number;
  currentUser: AuthUser;
  /** 닉네임·아바타·전적 공개 설정 변경 후 최신 내 정보를 상위 상태에 반영합니다. */
  onCurrentUserUpdated: (user: AuthUser) => void;
  onOpenProfile: (userId: number) => void;
  onOpenLeaderboard: () => void;
  onOpenFriends: (nickname?: string) => void;
  onBack: () => void;
  /** 회원 탈퇴가 끝났을 때(토큰은 이미 삭제됨) 로그인 화면 이동과 상태 정리를 맡깁니다. */
  onAccountDeleted?: () => void;
  /** 탈퇴 요청이 401로 끝났을 때(세션 종료·이미 탈퇴) 로그인 화면으로 보냅니다. */
  onSessionEnded?: () => void;
  /** 최근 로그인이 필요할 때 로그아웃하고 로그인 화면으로 보냅니다. */
  onRequireRelogin?: () => void;
  api?: ProfileApi;
  authClient?: AuthApiClient;
}

type StatsMap = Partial<Record<GameType, GameStats>>;

function ResultBadge({ result }: { result: MatchRecord["result"] }) {
  return (
    <span className={`cbc-result-badge is-${result}`}>
      {RESULT_LABELS[result]}
    </span>
  );
}

function GameStatCard({
  gameType,
  stats,
}: {
  gameType: GameType;
  stats: GameStats;
}) {
  const total = Math.max(stats.played, 1);
  return (
    <article className="cbc-profile-game-card" data-game={gameType}>
      <div className="cbc-profile-game-head">
        <div>
          <h3>{GAME_LABELS[gameType]}</h3>
          <p>
            참여 진행도 {stats.progress.current} / {stats.progress.target}
          </p>
        </div>
        <div className="cbc-profile-winrate">
          <strong>{formatWinRate(stats.winRate)}</strong>
          <span>승률</span>
        </div>
      </div>
      <div
        className="cbc-progress-bar"
        role="img"
        aria-label={`${stats.wins}승 ${stats.losses}패 ${stats.draws}무`}
      >
        <span
          className="is-win"
          style={{ width: `${(stats.wins / total) * 100}%` }}
        />
        <span
          className="is-draw"
          style={{ width: `${(stats.draws / total) * 100}%` }}
        />
      </div>
      <div className="cbc-profile-wld">
        <span>{stats.wins}승</span>
        <span>{stats.losses}패</span>
        <span>{stats.draws}무</span>
        <span>총 {stats.played}국</span>
      </div>
    </article>
  );
}

/**
 * 내 프로필(닉네임·아바타 편집)과 다른 사용자의 공개 프로필을 보여주며,
 * 게임별 통계와 최근 전적을 함께 표시합니다.
 */
export function ProfileView({
  userId,
  currentUser,
  onCurrentUserUpdated,
  onOpenProfile,
  onOpenLeaderboard,
  onOpenFriends,
  onBack,
  onAccountDeleted,
  onSessionEnded,
  onRequireRelogin,
  api = profileApi,
  authClient = authApi,
}: ProfileViewProps) {
  const isMine = userId === currentUser.id;

  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(
    null,
  );
  const [stats, setStats] = useState<StatsMap>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recordsPrivate, setRecordsPrivate] = useState(false);
  const recordsDeniedRef = useRef(false);

  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [matchFilter, setMatchFilter] = useState<GameType | "all">("all");
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  const [nicknameInput, setNicknameInput] = useState(currentUser.nickname);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    | "nickname"
    | "avatar"
    | "recordsPublic"
    | "twoFactorSetup"
    | "twoFactorEnable"
    | "twoFactorDisable"
    | "oauthLink"
    | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 사용자·종목이 바뀌면 올려서, 그 전에 보낸 "더 보기" 응답을 버립니다.
  const matchesGeneration = useRef(0);

  // Once either endpoint denies access, late successes must not re-display
  // earlier data. A fresh profile load is required before revealing records.
  const hidePrivateRecords = useCallback(() => {
    recordsDeniedRef.current = true;
    setRecordsPrivate(true);
    setStats({});
    setMatches([]);
    setNextBefore(null);
  }, []);

  // TOTP 2FA & 42 OAuth 상태 (FR-AUTH-05, FR-AUTH-06)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | undefined>(
    undefined,
  );
  const [twoFactorSetupData, setTwoFactorSetupData] =
    useState<TwoFactorSetupResponse | null>(null);
  const [twoFactorVerifyCode, setTwoFactorVerifyCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disableCodeInput, setDisableCodeInput] = useState("");
  const [disableModalError, setDisableModalError] = useState<string | null>(
    null,
  );
  const [oauthAlreadyLinked, setOauthAlreadyLinked] = useState(false);
  const disableTriggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteTriggerBtnRef = useRef<HTMLButtonElement | null>(null);

  // 내 프로필 진입 시 2FA 활성화 상태를 조회합니다.
  useEffect(() => {
    if (!isMine) return;
    let active = true;
    authClient
      .getTwoFactorStatus()
      .then((res) => {
        if (active && typeof res?.enabled === "boolean") {
          setTwoFactorEnabled(res.enabled);
        }
      })
      .catch(() => {
        // 2FA 상태 조회 실패 시 기본값 유지
      });
    return () => {
      active = false;
    };
  }, [authClient, isMine]);

  // 2FA 해제 모달이 열려 있을 때 Escape 키 입력 시 닫고 트리거 버튼으로 포커스를 복원합니다 (NFR-UX-02).
  useEffect(() => {
    if (!disableModalOpen) return;
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (busy !== "twoFactorDisable") {
          setDisableModalOpen(false);
          setDisableModalError(null);
          setDisableCodeInput("");
          disableTriggerBtnRef.current?.focus();
        }
      }
    }
    globalThis.window.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.window.removeEventListener("keydown", handleKeyDown);
    };
  }, [disableModalOpen, busy]);

  // 프로필(공개 정보)과 게임별 통계를 불러옵니다.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setPublicProfile(null);
    setStats({});
    recordsDeniedRef.current = false;
    setRecordsPrivate(false);

    Promise.all([
      isMine ? Promise.resolve(null) : api.getProfile(userId),
      Promise.all(GAME_TYPES.map((gameType) => api.getStats(userId, gameType)))
        .then((gameStats) => {
          if (!active || recordsDeniedRef.current) return;
          const next: StatsMap = {};
          GAME_TYPES.forEach((gameType, index) => {
            next[gameType] = gameStats[index];
          });
          setStats(next);
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (
            !isMine &&
            error instanceof ApiError &&
            error.code === "RECORDS_PRIVATE"
          ) {
            hidePrivateRecords();
            return;
          }
          throw error;
        }),
    ])
      .then(([profile]) => {
        if (!active) return;
        setPublicProfile(profile);
      })
      .catch((error) => {
        if (!active) return;
        // 탈퇴한 사용자의 프로필·통계·경기 기록 조회는 404입니다 (#89).
        setLoadError(
          !isMine && error instanceof ApiError && error.status === 404
            ? "존재하지 않거나 탈퇴한 사용자입니다."
            : getErrorMessage(error),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, userId, isMine, hidePrivateRecords]);

  const loadMatches = useCallback(
    async (
      before: number | undefined,
      replace: boolean,
      isActive: () => boolean,
    ) => {
      setMatchesLoading(true);
      setMatchesError(null);
      try {
        const page = await api.getMatches(userId, {
          gameType: matchFilter === "all" ? undefined : matchFilter,
          before,
          limit: MATCH_PAGE_SIZE,
        });
        if (!isActive() || recordsDeniedRef.current) return;
        setMatches((prev) =>
          replace ? page.matches : [...prev, ...page.matches],
        );
        setNextBefore(page.nextBefore);
      } catch (error) {
        if (isActive()) {
          if (
            !isMine &&
            error instanceof ApiError &&
            error.code === "RECORDS_PRIVATE"
          ) {
            hidePrivateRecords();
          } else {
            setMatchesError(getErrorMessage(error));
          }
        }
      } finally {
        if (isActive()) setMatchesLoading(false);
      }
    },
    [api, userId, matchFilter, isMine, hidePrivateRecords],
  );

  // 전적 첫 페이지 (사용자·종목 필터 변경 시 재조회).
  useEffect(() => {
    let active = true;
    const generation = ++matchesGeneration.current;
    setMatches([]);
    setNextBefore(null);
    void loadMatches(
      undefined,
      true,
      () => active && generation === matchesGeneration.current,
    );
    return () => {
      active = false;
    };
  }, [loadMatches]);

  // 내 닉네임이 외부에서 바뀌면 입력창도 맞춥니다.
  useEffect(() => {
    setNicknameInput(currentUser.nickname);
  }, [currentUser.nickname]);

  // 다른 사용자 화면으로 이동할 때 편집 메시지를 초기화합니다.
  useEffect(() => {
    setNotice(null);
    setActionError(null);
    setNicknameError(null);
  }, [userId]);

  const displayName = isMine
    ? currentUser.nickname
    : (publicProfile?.nickname ?? "");
  const displayAvatar = isMine
    ? currentUser.avatarUrl
    : (publicProfile?.avatarUrl ?? null);

  const statList = GAME_TYPES.flatMap((gameType) => stats[gameType] ?? []);
  const total = sumStats(statList);
  const hasFirstWin = statList.some((s) => s.achievements.firstWin);
  const hasParticipation = statList.some(
    (s) => s.progress.current >= s.progress.target,
  );
  const achievementCount = Number(hasFirstWin) + Number(hasParticipation);

  async function handleRecordsPublicChange(recordsPublic: boolean) {
    if (busy !== null) return;
    setBusy("recordsPublic");
    setNotice(null);
    setActionError(null);
    try {
      const user = await api.updateRecordsPublic(recordsPublic);
      onCurrentUserUpdated({ ...currentUser, ...user });
      setNotice(
        recordsPublic
          ? "전적을 공개로 설정했습니다."
          : "전적을 비공개로 설정했습니다.",
      );
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleNicknameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setActionError(null);
    setNicknameError(null);
    const nickname = nicknameInput.trim();
    if (nickname === currentUser.nickname) {
      setNicknameError("현재 닉네임과 동일합니다.");
      return;
    }
    setBusy("nickname");
    try {
      const user = await api.updateNickname(nickname);
      onCurrentUserUpdated({ ...currentUser, ...user });
      setNotice("닉네임이 변경되었습니다.");
    } catch (error) {
      setNicknameError(
        getAuthFieldErrors(error).nickname ?? getErrorMessage(error),
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleAvatarSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 선택해도 change 이벤트가 발생하도록 초기화합니다.
    event.target.value = "";
    if (!file) return;
    setNotice(null);
    setActionError(null);
    const problem = validateAvatarFile(file);
    if (problem) {
      setActionError(problem);
      return;
    }
    setBusy("avatar");
    try {
      const user = await api.uploadAvatar(file);
      onCurrentUserUpdated({ ...currentUser, ...user });
      setNotice("프로필 이미지가 변경되었습니다.");
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleAvatarDelete() {
    setNotice(null);
    setActionError(null);
    setBusy("avatar");
    try {
      await api.deleteAvatar();
      onCurrentUserUpdated({ ...currentUser, avatarUrl: null });
      setNotice("프로필 이미지를 삭제하고 기본 이미지로 되돌렸습니다.");
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleStartTwoFactorSetup() {
    setNotice(null);
    setActionError(null);
    setRecoveryCodes(null);
    setTwoFactorVerifyCode("");
    setBusy("twoFactorSetup");
    try {
      const setupData = await authClient.setupTwoFactor();
      setTwoFactorSetupData(setupData);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "TWO_FACTOR_ALREADY_ENABLED"
      ) {
        setTwoFactorEnabled(true);
      }
      setActionError(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleEnableTwoFactorSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setNotice(null);
    setActionError(null);
    const trimmed = twoFactorVerifyCode.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setActionError("인증 앱에 표시된 6자리 숫자를 입력해 주세요.");
      return;
    }
    setBusy("twoFactorEnable");
    try {
      const res = await authClient.enableTwoFactor(trimmed);
      setTwoFactorEnabled(true);
      setTwoFactorSetupData(null);
      setTwoFactorVerifyCode("");
      setRecoveryCodes(res.recoveryCodes);
      setNotice(
        "2단계 인증(TOTP)이 활성화되었습니다. 아래 1회용 복구 코드 10개를 안전한 곳에 보관해 주세요.",
      );
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisableTwoFactorSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setDisableModalError(null);
    const trimmed = disableCodeInput.trim();
    if (trimmed.length < 6) {
      setDisableModalError(
        "현재 6자리 인증 코드 또는 복구 코드(ABCD-EFGH)를 입력해 주세요.",
      );
      return;
    }
    setBusy("twoFactorDisable");
    try {
      await authClient.disableTwoFactor(trimmed);
      setTwoFactorEnabled(false);
      setTwoFactorSetupData(null);
      setRecoveryCodes(null);
      setDisableModalOpen(false);
      setDisableCodeInput("");
      setNotice("2단계 인증(2FA)이 비활성화되었습니다.");
      disableTriggerBtnRef.current?.focus();
    } catch (error) {
      setDisableModalError(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleStartOAuth42Link() {
    setNotice(null);
    setActionError(null);
    setBusy("oauthLink");
    try {
      const { authorizeUrl } = await authClient.startOAuth42Link();
      if (
        typeof globalThis.window !== "undefined" &&
        globalThis.window.location
      ) {
        globalThis.window.location.assign(authorizeUrl);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "OAUTH_ALREADY_LINKED") {
        setOauthAlreadyLinked(true);
      }
      setActionError(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="cbc-profile-page">
      <div className="cbc-profile-topbar">
        <button type="button" className="cbc-link" onClick={onBack}>
          ← 이전으로
        </button>
        <button type="button" className="cbc-link" onClick={onOpenLeaderboard}>
          리더보드 보기
        </button>
      </div>

      <header>
        <span className="cbc-eyebrow">
          {isMine ? "카페 라운지 멤버십" : "사용자 공개 프로필"}
        </span>
        <h1 className="cbc-profile-title">
          {isMine
            ? "내 프로필 및 활동"
            : `${displayName || "사용자"} 님의 프로필`}
        </h1>
      </header>

      {notice && (
        <div className="cbc-success-banner" role="status">
          <span>{notice}</span>
        </div>
      )}
      {(actionError || loadError) && (
        <div className="cbc-error-banner" role="alert">
          <span>{actionError ?? loadError}</span>
        </div>
      )}

      {loading ? (
        <p className="m-0 text-sm/5 text-on-surface-variant" role="status">
          프로필을 불러오는 중입니다...
        </p>
      ) : loadError ? null : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[340px_1fr]">
          <aside className="flex min-w-0 flex-col gap-6">
            <section className="cbc-profile-card cbc-profile-identity">
              <Avatar
                nickname={displayName}
                avatarUrl={displayAvatar}
                size={112}
              />
              <h2 className="cbc-profile-name">{displayName}</h2>
              <p className="cbc-profile-id">회원 번호 #{userId}</p>
              <button
                type="button"
                className="cbc-btn-secondary cbc-btn-compact"
                onClick={() => onOpenFriends(isMine ? undefined : displayName)}
              >
                {isMine ? "친구 관리" : "친구 검색·요청"}
              </button>

              {isMine && (
                <>
                  <div className="mt-2 flex w-full gap-2">
                    <button
                      type="button"
                      className="cbc-btn-primary cbc-btn-compact"
                      disabled={busy !== null}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {busy === "avatar" ? "처리 중..." : "이미지 업로드"}
                    </button>
                    <button
                      type="button"
                      className="cbc-btn-secondary cbc-btn-compact"
                      disabled={busy !== null || !currentUser.avatarUrl}
                      onClick={handleAvatarDelete}
                    >
                      삭제
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    data-testid="avatar-file-input"
                    aria-label="프로필 이미지 파일 선택"
                    onChange={handleAvatarSelected}
                  />
                  <p className="m-0 text-[12px] text-on-surface-variant">
                    PNG, JPEG 파일 지원 (최대 2MB, 1024px 이하)
                  </p>
                </>
              )}
            </section>

            {isMine && (
              <section className="cbc-profile-card">
                <h2 className="mx-0 mt-0 mb-4 font-display text-[20px]">
                  계정 정보
                </h2>
                <form
                  className="flex flex-col gap-5"
                  onSubmit={handleNicknameSubmit}
                  noValidate
                >
                  <div className="flex flex-col gap-1.5">
                    <label
                      className="text-sm/5 font-semibold tracking-[0.01em] text-on-surface"
                      htmlFor="profile-nickname"
                    >
                      닉네임
                    </label>
                    <div className="cbc-profile-nickname-row">
                      <input
                        id="profile-nickname"
                        className={`cbc-input ${nicknameError ? "is-error" : ""}`}
                        value={nicknameInput}
                        onChange={(e) => {
                          setNicknameInput(e.target.value);
                          setNicknameError(null);
                        }}
                        aria-invalid={Boolean(nicknameError)}
                        aria-describedby={
                          nicknameError ? "profile-nickname-error" : undefined
                        }
                      />
                      <button
                        type="submit"
                        className="cbc-btn-primary cbc-btn-compact"
                        disabled={
                          busy !== null || nicknameInput.trim().length === 0
                        }
                      >
                        {busy === "nickname" ? "저장 중..." : "변경 저장"}
                      </button>
                    </div>
                    {nicknameError ? (
                      <p
                        id="profile-nickname-error"
                        className="cbc-field-error"
                      >
                        {nicknameError}
                      </p>
                    ) : (
                      <p className="cbc-field-helper">
                        <span>2~32자 (문자·숫자·_·-)</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      className="text-sm/5 font-semibold tracking-[0.01em] text-on-surface"
                      htmlFor="profile-email"
                    >
                      이메일 (읽기 전용)
                    </label>
                    <input
                      id="profile-email"
                      className="cbc-input"
                      value={currentUser.email}
                      readOnly
                      disabled
                    />
                  </div>
                </form>
              </section>
            )}

            {isMine && (
              <section
                className="cbc-profile-card"
                data-testid="profile-records-settings"
              >
                <h2 className="mx-0 mt-0 mb-4 font-display text-[20px]">
                  전적 공개 설정
                </h2>
                <div className="cbc-profile-privacy-toggle">
                  <input
                    id="profile-records-public"
                    type="checkbox"
                    role="switch"
                    checked={currentUser.recordsPublic === true}
                    disabled={
                      busy !== null ||
                      typeof currentUser.recordsPublic !== "boolean"
                    }
                    aria-describedby="profile-records-scope"
                    onChange={(event) =>
                      void handleRecordsPublicChange(
                        event.currentTarget.checked,
                      )
                    }
                  />
                  <label htmlFor="profile-records-public">전적 공개</label>
                  <span aria-live="polite">
                    {busy === "recordsPublic"
                      ? "저장 중..."
                      : typeof currentUser.recordsPublic !== "boolean"
                        ? "설정 확인 불가"
                        : currentUser.recordsPublic
                          ? "공개"
                          : "비공개"}
                  </span>
                </div>
                <p
                  id="profile-records-scope"
                  className="m-0 text-[12px] text-on-surface-variant"
                >
                  비공개로 설정하면 다른 사용자는 내 프로필의 통계·업적·경기
                  기록을 볼 수 없습니다. 리더보드와 상대방 자신의 대국 기록에는
                  계속 표시됩니다.
                </p>
              </section>
            )}

            {isMine && (
              <section
                className="cbc-profile-card"
                data-testid="profile-security-section"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2 className="m-0 font-display text-[20px]">
                    보안 및 계정 연동
                  </h2>
                  <span
                    className={`cbc-security-pill ${
                      twoFactorEnabled ? "" : "is-muted"
                    }`}
                    data-testid="two-factor-status-pill"
                  >
                    {twoFactorEnabled && <span className="cbc-pulse-dot" />}
                    {twoFactorEnabled ? "2FA 사용 중" : "2FA 미설정"}
                  </span>
                </div>

                <div className="cbc-security-block">
                  <p
                    className="m-0 text-[12px] text-on-surface-variant"
                    style={{ marginBottom: "0.75rem" }}
                  >
                    인증 앱(Google Authenticator, Authy 등) 기반 TOTP 2단계
                    인증으로 계정을 보호하거나 42 Intra 계정을 연결할 수
                    있습니다.
                  </p>

                  {!twoFactorEnabled && !twoFactorSetupData && (
                    <button
                      type="button"
                      className="cbc-btn-primary cbc-btn-compact"
                      style={{ width: "100%" }}
                      disabled={busy !== null}
                      data-testid="start-2fa-setup-btn"
                      onClick={handleStartTwoFactorSetup}
                    >
                      {busy === "twoFactorSetup"
                        ? "비밀키 발급 중..."
                        : "2단계 인증(2FA) 설정 시작"}
                    </button>
                  )}

                  {!twoFactorEnabled && twoFactorSetupData && (
                    <div
                      className="cbc-2fa-setup-box"
                      data-testid="two-factor-setup-panel"
                    >
                      <h3 className="cbc-2fa-box-title">
                        1단계: 인증 앱에 시크릿 등록
                      </h3>
                      <p className="m-0 text-[12px] text-on-surface-variant">
                        인증 앱에서 수동 키 입력을 선택하고 아래 Base32 비밀키를
                        등록하거나 <code>otpauth://</code> URI를 여세요.
                      </p>
                      <div className="cbc-2fa-secret-box">
                        <span className="cbc-2fa-secret-label">
                          수동 입력용 Base32 시크릿
                        </span>
                        <code
                          className="cbc-2fa-secret-code"
                          data-testid="two-factor-secret-code"
                        >
                          {twoFactorSetupData.secret}
                        </code>
                      </div>
                      <div className="cbc-2fa-uri-row">
                        <a
                          href={twoFactorSetupData.otpauthUrl}
                          className="cbc-link"
                          style={{ fontSize: "12px", wordBreak: "break-all" }}
                          data-testid="two-factor-otpauth-link"
                        >
                          인증 앱 열기 (otpauth URI)
                        </a>
                      </div>

                      <form
                        className="flex flex-col gap-5"
                        style={{ marginTop: "0.75rem" }}
                        onSubmit={handleEnableTwoFactorSubmit}
                      >
                        <div className="flex flex-col gap-1.5">
                          <label
                            className="text-sm/5 font-semibold tracking-[0.01em] text-on-surface"
                            htmlFor="two-factor-enable-code"
                          >
                            2단계: 인증 앱의 6자리 코드 입력
                          </label>
                          <input
                            id="two-factor-enable-code"
                            type="text"
                            inputMode="numeric"
                            pattern="\d{6}"
                            maxLength={6}
                            placeholder="6자리 숫자 (예: 123456)"
                            className="cbc-input"
                            data-testid="two-factor-enable-code-input"
                            value={twoFactorVerifyCode}
                            onChange={(e) =>
                              setTwoFactorVerifyCode(e.target.value)
                            }
                            required
                          />
                        </div>
                        <div className="mt-2 flex w-full gap-2">
                          <button
                            type="button"
                            className="cbc-btn-secondary cbc-btn-compact"
                            disabled={busy !== null}
                            onClick={() => {
                              setTwoFactorSetupData(null);
                              setTwoFactorVerifyCode("");
                            }}
                          >
                            취소
                          </button>
                          <button
                            type="submit"
                            className="cbc-btn-primary cbc-btn-compact"
                            disabled={busy !== null}
                            data-testid="confirm-2fa-enable-btn"
                          >
                            {busy === "twoFactorEnable"
                              ? "확인 중..."
                              : "코드 확인 및 활성화"}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {twoFactorEnabled && (
                    <button
                      ref={disableTriggerBtnRef}
                      type="button"
                      className="cbc-btn-secondary cbc-btn-compact"
                      style={{ width: "100%" }}
                      disabled={busy !== null}
                      data-testid="open-2fa-disable-modal-btn"
                      onClick={() => {
                        setDisableModalError(null);
                        setDisableCodeInput("");
                        setDisableModalOpen(true);
                      }}
                    >
                      2단계 인증 해제
                    </button>
                  )}

                  {recoveryCodes && recoveryCodes.length > 0 && (
                    <div
                      className="cbc-2fa-recovery-box"
                      data-testid="two-factor-recovery-codes"
                    >
                      <h3 className="cbc-2fa-box-title">
                        1회용 복구 코드 10개 (최초 1회만 표시)
                      </h3>
                      <p className="m-0 text-[12px] text-on-surface-variant">
                        인증 기기를 분실했을 때 로그인 코드 대신 1회씩 사용할 수
                        있습니다. 지금 안전한 곳에 복사·보관해 주세요.
                      </p>
                      <ul className="cbc-2fa-recovery-grid">
                        {recoveryCodes.map((code) => (
                          <li key={code}>
                            <code>{code}</code>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="cbc-btn-secondary cbc-btn-compact"
                        style={{ width: "100%", marginTop: "0.5rem" }}
                        data-testid="ack-recovery-codes-btn"
                        onClick={() => setRecoveryCodes(null)}
                      >
                        복구 코드를 안전하게 보관했습니다
                      </button>
                    </div>
                  )}

                  <hr className="cbc-security-divider" />

                  <div className="cbc-oauth-link-block">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <strong style={{ fontSize: "14px" }}>
                        42 Intra 계정 연동
                      </strong>
                      {oauthAlreadyLinked && (
                        <span className="cbc-chip">연결됨</span>
                      )}
                    </div>
                    <p
                      className="m-0 text-[12px] text-on-surface-variant"
                      style={{ marginBottom: "0.625rem" }}
                    >
                      현재 계정에 42 Intra 계정을 연결하면 다음부터 42 OAuth로도
                      동일 계정에 로그인할 수 있습니다.
                    </p>
                    <button
                      type="button"
                      className="cbc-btn-secondary cbc-btn-compact"
                      style={{ width: "100%" }}
                      disabled={busy !== null || oauthAlreadyLinked}
                      data-testid="start-oauth42-link-btn"
                      onClick={handleStartOAuth42Link}
                    >
                      {busy === "oauthLink"
                        ? "42 인증 페이지 이동 중..."
                        : oauthAlreadyLinked
                          ? "42 Intra 계정 연결 완료"
                          : "42 Intra 계정 연결하기"}
                    </button>
                  </div>
                </div>
              </section>
            )}
            {isMine && (
              <section
                className="cbc-profile-card cbc-profile-danger"
                data-testid="profile-danger-zone"
                aria-labelledby="profile-danger-title"
              >
                <h2
                  id="profile-danger-title"
                  className="mx-0 mt-0 mb-4 font-display text-[20px]"
                >
                  회원 탈퇴
                </h2>
                <p className="m-0 text-[12px] text-on-surface-variant">
                  계정과 로그인 정보를 삭제합니다. 되돌릴 수 없으며, 경기 결과는
                  상대방 전적에 &quot;(탈퇴한 사용자)&quot;로 남습니다.
                </p>
                <button
                  ref={deleteTriggerBtnRef}
                  type="button"
                  className="cbc-btn-danger cbc-btn-compact"
                  disabled={busy !== null}
                  data-testid="open-delete-account-btn"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  회원 탈퇴
                </button>
              </section>
            )}
          </aside>

          <div className="flex min-w-0 flex-col gap-6">
            {recordsPrivate ? (
              <section
                className="cbc-profile-card"
                role="status"
                data-testid="records-private-notice"
              >
                <h2 className="mx-0 mt-0 mb-4 font-display text-[20px]">
                  전적이 비공개입니다
                </h2>
                <p>
                  이 사용자는 통계·업적·경기 기록을 비공개로 설정했습니다.
                  닉네임과 프로필 이미지는 볼 수 있습니다.
                </p>
              </section>
            ) : (
              <>
                <section className="cbc-profile-card">
                  <h2 className="mx-0 mt-0 mb-4 font-display text-[20px]">
                    게임별 전적 및 승률
                  </h2>
                  <div className="cbc-profile-total">
                    <strong>
                      총 {total.played}전 {total.wins}승 {total.losses}패{" "}
                      {total.draws}무
                    </strong>
                    <span>종합 승률 {formatWinRate(total.winRate)}</span>
                  </div>
                  <div className="cbc-profile-game-grid">
                    {GAME_TYPES.map((gameType) => {
                      const gameStats = stats[gameType];
                      return gameStats ? (
                        <GameStatCard
                          key={gameType}
                          gameType={gameType}
                          stats={gameStats}
                        />
                      ) : null;
                    })}
                  </div>
                </section>

                <section className="cbc-profile-card">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <h2 className="m-0 font-display text-[20px]">
                      보드카페 업적
                    </h2>
                    <span className="cbc-chip">
                      달성 완료: {achievementCount} / 2
                    </span>
                  </div>
                  <ul className="cbc-achievements">
                    <li className={hasFirstWin ? "is-done" : ""}>
                      <strong>첫 승리</strong>
                      <span>오목 또는 오델로 대국에서 첫 1승 달성</span>
                      <em>{hasFirstWin ? "달성 완료" : "미달성"}</em>
                    </li>
                    <li className={hasParticipation ? "is-done" : ""}>
                      <strong>10경기 참여</strong>
                      <span>한 종목에서 대국을 10회 이상 완료</span>
                      <em>{hasParticipation ? "달성 완료" : "미달성"}</em>
                    </li>
                  </ul>
                </section>

                <section className="cbc-profile-card">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <h2 className="m-0 font-display text-[20px]">
                      최근 경기 기록
                    </h2>
                    <div
                      className="cbc-tabs"
                      role="tablist"
                      aria-label="종목 필터"
                    >
                      {(["all", ...GAME_TYPES] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={matchFilter === value}
                          className={matchFilter === value ? "is-active" : ""}
                          onClick={() => setMatchFilter(value)}
                        >
                          {value === "all"
                            ? "전체"
                            : value === "gomoku"
                              ? "오목"
                              : "오델로"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {matchesError && (
                    <div className="cbc-error-banner" role="alert">
                      <span>{matchesError}</span>
                    </div>
                  )}

                  {matches.length === 0 && !matchesLoading && !matchesError ? (
                    <p className="m-0 text-sm/5 text-on-surface-variant">
                      아직 종료된 경기 기록이 없습니다.
                    </p>
                  ) : (
                    <div className="cbc-table-wrap">
                      <table className="cbc-table">
                        <thead>
                          <tr>
                            <th>상대 플레이어</th>
                            <th>종목</th>
                            <th>결과</th>
                            <th>일시</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matches.map((match) => {
                            const opponent = describeOpponent(match.opponent);
                            return (
                              <tr key={match.matchId}>
                                <td>
                                  {opponent.linkable ? (
                                    <button
                                      type="button"
                                      className="cbc-table-user"
                                      onClick={() =>
                                        onOpenProfile(match.opponent.id)
                                      }
                                    >
                                      <Avatar
                                        nickname={match.opponent.nickname}
                                        size={32}
                                      />
                                      <span>{opponent.label}</span>
                                    </button>
                                  ) : (
                                    <span
                                      className="cbc-table-user is-deleted"
                                      data-testid="deleted-opponent"
                                    >
                                      <Avatar
                                        nickname={match.opponent.nickname}
                                        size={32}
                                      />
                                      <span>{opponent.label}</span>
                                    </span>
                                  )}
                                </td>
                                <td>{GAME_LABELS[match.gameType]}</td>
                                <td>
                                  <ResultBadge result={match.result} />
                                </td>
                                <td>{formatMatchDate(match.finishedAt)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {matchesLoading && (
                    <p
                      className="m-0 text-sm/5 text-on-surface-variant"
                      role="status"
                    >
                      전적을 불러오는 중입니다...
                    </p>
                  )}
                  {nextBefore !== null && !matchesLoading && (
                    <button
                      type="button"
                      className="cbc-btn-secondary cbc-btn-compact"
                      onClick={() => {
                        const generation = matchesGeneration.current;
                        void loadMatches(
                          nextBefore,
                          false,
                          () => generation === matchesGeneration.current,
                        );
                      }}
                    >
                      더 보기
                    </button>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}

      {deleteDialogOpen && (
        <DeleteAccountDialog
          nickname={currentUser.nickname}
          hasPassword={currentUser.hasPassword}
          twoFactorEnabled={twoFactorEnabled}
          authClient={authClient}
          onClose={() => {
            setDeleteDialogOpen(false);
            deleteTriggerBtnRef.current?.focus();
          }}
          onDeleted={() => {
            setDeleteDialogOpen(false);
            onAccountDeleted?.();
          }}
          onSessionEnded={() => {
            setDeleteDialogOpen(false);
            onSessionEnded?.();
          }}
          onRequireRelogin={() => {
            setDeleteDialogOpen(false);
            onRequireRelogin?.();
          }}
        />
      )}

      {/* 2FA Disable Confirmation Modal (19_2fa_disable_modal) */}
      {disableModalOpen && (
        <div
          className="cbc-modal-backdrop"
          data-testid="two-factor-disable-backdrop"
          onClick={() => {
            if (busy !== "twoFactorDisable") {
              setDisableModalOpen(false);
              setDisableModalError(null);
              setDisableCodeInput("");
              disableTriggerBtnRef.current?.focus();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="two-factor-disable-title"
            aria-describedby="two-factor-disable-desc"
            className="cbc-modal-dialog"
            data-testid="two-factor-disable-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cbc-modal-alert-icon" aria-hidden="true">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm1 14h-2v-2h2v2zm0-4h-2V7h2v4z" />
              </svg>
            </div>
            <h3
              id="two-factor-disable-title"
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "22px",
                margin: "0 0 0.5rem",
              }}
            >
              2단계 인증(2FA)을 비활성화할까요?
            </h3>
            <p
              id="two-factor-disable-desc"
              className="m-0 text-sm/5 text-on-surface-variant"
              style={{ maxWidth: "340px" }}
            >
              보안 확인을 위해 현재 인증 앱의 6자리 숫자 또는 남은 복구 코드
              (ABCD-EFGH)를 입력해 주세요.
            </p>

            <form
              className="flex flex-col gap-5"
              style={{ width: "100%", marginTop: "0.75rem", textAlign: "left" }}
              onSubmit={handleDisableTwoFactorSubmit}
            >
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-sm/5 font-semibold tracking-[0.01em] text-on-surface"
                  htmlFor="two-factor-disable-code"
                >
                  인증 코드 또는 복구 코드
                </label>
                <input
                  id="two-factor-disable-code"
                  type="text"
                  placeholder="6자리 숫자 또는 ABCD-EFGH"
                  className={`cbc-input ${disableModalError ? "is-error" : ""}`}
                  data-testid="two-factor-disable-code-input"
                  value={disableCodeInput}
                  onChange={(e) => {
                    setDisableCodeInput(e.target.value);
                    if (disableModalError) setDisableModalError(null);
                  }}
                  required
                />
              </div>

              {disableModalError && (
                <div className="cbc-error-banner" role="alert">
                  <span>{disableModalError}</span>
                </div>
              )}

              <div className="cbc-modal-actions">
                <button
                  type="button"
                  className="cbc-btn-secondary"
                  disabled={busy === "twoFactorDisable"}
                  onClick={() => {
                    setDisableModalOpen(false);
                    setDisableModalError(null);
                    setDisableCodeInput("");
                    disableTriggerBtnRef.current?.focus();
                  }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="cbc-btn-danger"
                  disabled={busy === "twoFactorDisable"}
                  data-testid="confirm-2fa-disable-btn"
                >
                  <span>
                    {busy === "twoFactorDisable"
                      ? "해제 중..."
                      : "2단계 인증 비활성화"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
