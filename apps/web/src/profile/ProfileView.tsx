import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type { AuthUser } from "../api/auth-client.ts";
import { getAuthFieldErrors, getErrorMessage } from "../api/errors.ts";
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

const GAME_TYPES: GameType[] = ["gomoku", "othello"];
const MATCH_PAGE_SIZE = 10;

/** 조회 대상·로그인 사용자와 편집 결과 반영·화면 이동 동작을 받는 프로필 화면 속성입니다. */
interface ProfileViewProps {
  /** 조회할 사용자 ID. 로그인한 본인의 ID이면 편집 가능한 "내 프로필"로 표시합니다. */
  userId: number;
  currentUser: AuthUser;
  /** 닉네임·아바타 변경 후 최신 내 정보를 상위 상태에 반영합니다. */
  onCurrentUserUpdated: (user: AuthUser) => void;
  onOpenProfile: (userId: number) => void;
  onOpenLeaderboard: () => void;
  onBack: () => void;
  api?: ProfileApi;
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
  onBack,
  api = profileApi,
}: ProfileViewProps) {
  const isMine = userId === currentUser.id;

  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(
    null,
  );
  const [stats, setStats] = useState<StatsMap>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [matchFilter, setMatchFilter] = useState<GameType | "all">("all");
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  const [nicknameInput, setNicknameInput] = useState(currentUser.nickname);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"nickname" | "avatar" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 사용자·종목이 바뀌면 올려서, 그 전에 보낸 "더 보기" 응답을 버립니다.
  const matchesGeneration = useRef(0);

  // 프로필(공개 정보)과 게임별 통계를 불러옵니다.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setPublicProfile(null);
    setStats({});

    Promise.all([
      isMine ? Promise.resolve(null) : api.getProfile(userId),
      ...GAME_TYPES.map((gameType) => api.getStats(userId, gameType)),
    ])
      .then(([profile, ...gameStats]) => {
        if (!active) return;
        setPublicProfile(profile);
        const next: StatsMap = {};
        GAME_TYPES.forEach((gameType, index) => {
          next[gameType] = gameStats[index] as GameStats;
        });
        setStats(next);
      })
      .catch((error) => {
        if (active) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, userId, isMine]);

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
        if (!isActive()) return;
        setMatches((prev) =>
          replace ? page.matches : [...prev, ...page.matches],
        );
        setNextBefore(page.nextBefore);
      } catch (error) {
        if (isActive()) setMatchesError(getErrorMessage(error));
      } finally {
        if (isActive()) setMatchesLoading(false);
      }
    },
    [api, userId, matchFilter],
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
      onCurrentUserUpdated(user);
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
      onCurrentUserUpdated(user);
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
        <p className="cbc-subheading" role="status">
          프로필을 불러오는 중입니다...
        </p>
      ) : loadError ? null : (
        <div className="cbc-profile-layout">
          <aside className="cbc-profile-side">
            <section className="cbc-profile-card cbc-profile-identity">
              <Avatar
                nickname={displayName}
                avatarUrl={displayAvatar}
                size={112}
              />
              <h2 className="cbc-profile-name">{displayName}</h2>
              <p className="cbc-profile-id">회원 번호 #{userId}</p>

              {isMine && (
                <>
                  <div className="cbc-profile-avatar-actions">
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
                  <p className="cbc-profile-hint">
                    PNG, JPEG 파일 지원 (최대 2MB, 1024px 이하)
                  </p>
                </>
              )}
            </section>

            {isMine && (
              <section className="cbc-profile-card">
                <h2 className="cbc-profile-section-title">계정 정보</h2>
                <form
                  className="cbc-form"
                  onSubmit={handleNicknameSubmit}
                  noValidate
                >
                  <div className="cbc-field">
                    <label className="cbc-label" htmlFor="profile-nickname">
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
                  <div className="cbc-field">
                    <label className="cbc-label" htmlFor="profile-email">
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
          </aside>

          <div className="cbc-profile-main">
            <section className="cbc-profile-card">
              <h2 className="cbc-profile-section-title">게임별 전적 및 승률</h2>
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
              <div className="cbc-profile-section-head">
                <h2 className="cbc-profile-section-title">보드카페 업적</h2>
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
              <div className="cbc-profile-section-head">
                <h2 className="cbc-profile-section-title">최근 경기 기록</h2>
                <div className="cbc-tabs" role="tablist" aria-label="종목 필터">
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
                <p className="cbc-subheading">
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
                      {matches.map((match) => (
                        <tr key={match.matchId}>
                          <td>
                            <button
                              type="button"
                              className="cbc-table-user"
                              onClick={() => onOpenProfile(match.opponent.id)}
                            >
                              <Avatar
                                nickname={match.opponent.nickname}
                                size={32}
                              />
                              <span>{match.opponent.nickname}</span>
                            </button>
                          </td>
                          <td>{GAME_LABELS[match.gameType]}</td>
                          <td>
                            <ResultBadge result={match.result} />
                          </td>
                          <td>{formatMatchDate(match.finishedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {matchesLoading && (
                <p className="cbc-subheading" role="status">
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
          </div>
        </div>
      )}
    </div>
  );
}
