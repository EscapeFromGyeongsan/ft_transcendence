import { useEffect, useState } from "react";
import { profileApi, type GameStats } from "../api/profile-api.ts";
import { formatWinRate } from "../api/profile-format.ts";
import type { WsConnectionPhase } from "./gomoku-state.ts";
import {
  formatQueueElapsed,
  getGameCatalogEntry,
  type MatchmakingClientState,
} from "./matchmaking-state.ts";

/**
 * 실시간 자동 매칭 대기 화면(`MatchmakingView`) 컴포넌트의 Props입니다.
 */
export interface MatchmakingViewProps {
  /** 현재 매칭 대기열 상태 */
  state: MatchmakingClientState;
  /** 실시간 WebSocket 연결 상태 */
  connectionPhase: WsConnectionPhase;
  /** 현재 로그인한 사용자 ID (내 전적 요약 조회용) */
  userId?: number | null;
  /** 외부에서 주입할 통계 데이터 (테스트 및 초기 렌더링용) */
  initialStats?: GameStats | null;
  /** 매칭 취소 버튼 클릭 또는 Escape 입력 시 호출되는 콜백 (`queue.leave` 전송) */
  onCancelQueue: () => void;
  /** 매칭 오류 배너 닫기 콜백 */
  onDismissError?: () => void;
}

/**
 * 선택한 게임의 매칭 대기(`queue.join` → `queue.joined`) 상태를 표시하고
 * 매칭 취소(`queue.leave`) 및 규칙·전적 요약을 제공하는 화면 컴포넌트입니다 (SDS 2.2 `06_matchmaking_waiting`, IF-06).
 */
export function MatchmakingView({
  state,
  connectionPhase,
  userId = null,
  initialStats = null,
  onCancelQueue,
  onDismissError,
}: MatchmakingViewProps) {
  const activeGameType = state.queuedGameType ?? state.selectedGameType;
  const catalog = getGameCatalogEntry(activeGameType);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [stats, setStats] = useState<GameStats | null>(initialStats);

  // 1초마다 경과 시간 타이머를 갱신합니다.
  useEffect(() => {
    if (state.phase !== "queued" && state.phase !== "leaving") {
      return;
    }
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [state.phase, state.queuedAtMs]);

  // 현재 사용자의 선택한 게임 통계를 불러옵니다.
  useEffect(() => {
    if (initialStats) {
      setStats(initialStats);
      return;
    }
    if (userId === null) {
      return;
    }
    let mounted = true;
    profileApi
      .getStats(userId, activeGameType)
      .then((res) => {
        if (mounted) setStats(res);
      })
      .catch(() => {
        // 통계 조회 실패 시 기본값(0전)으로 표시합니다.
      });
    return () => {
      mounted = false;
    };
  }, [userId, activeGameType, initialStats]);

  // Escape 키로 매칭 취소를 지원합니다 (NFR-UX-02).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && state.phase !== "leaving") {
        event.preventDefault();
        onCancelQueue();
      }
    }
    if (typeof globalThis.window !== "undefined") {
      globalThis.window.addEventListener("keydown", handleKeyDown);
      return () =>
        globalThis.window.removeEventListener("keydown", handleKeyDown);
    }
    return undefined;
  }, [state.phase, onCancelQueue]);

  const elapsedText = formatQueueElapsed(state.queuedAtMs, nowMs);
  const elapsedSeconds =
    state.queuedAtMs !== null
      ? Math.max(0, Math.floor((nowMs - state.queuedAtMs) / 1000))
      : 0;
  const ringCircumference = 440;
  const ringProgress = (elapsedSeconds % 45) / 45;
  const ringDashOffset = Math.round(
    ringCircumference - ringProgress * ringCircumference,
  );

  const isLeaving = state.phase === "leaving";
  const isJoining = state.phase === "joining";

  const statusHeadline = isLeaving
    ? "매칭 취소를 처리하는 중입니다..."
    : isJoining
      ? "매칭 대기열에 등록하는 중입니다..."
      : "대전 상대를 찾는 중입니다...";

  const played = stats?.played ?? 0;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const draws = stats?.draws ?? 0;
  const winRateDisplay =
    played === 0 ? "-" : formatWinRate(stats?.winRate ?? 0);
  const winWidthPct = played > 0 ? Math.round((wins / played) * 1000) / 10 : 0;
  const drawWidthPct =
    played > 0 ? Math.round((draws / played) * 1000) / 10 : 0;

  return (
    <div
      className="cbc-matchmaking-page"
      data-testid="matchmaking-view"
      data-matchmaking-phase={state.phase}
      data-game-type={activeGameType}
    >
      {/* 상단 타이틀 헤더 */}
      <div className="cbc-matchmaking-header">
        <div className="cbc-matchmaking-header-left">
          <div className="cbc-matchmaking-icon-box" aria-hidden="true">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="6" width="20" height="12" rx="6" />
              <path d="M6 12h4M8 10v4M15 11h.01M18 13h.01" />
            </svg>
          </div>
          <div>
            <div className="cbc-matchmaking-eyebrow">
              <span className="cbc-pulse-dot" />
              <span>실시간 대전 매칭 · {catalog.rulesVersion}</span>
            </div>
            <h1 className="cbc-matchmaking-title">{catalog.waitingTitle}</h1>
          </div>
        </div>

        <span
          className="cbc-security-pill"
          data-testid="matchmaking-ws-pill"
          data-ws-phase={connectionPhase}
        >
          <span className="cbc-pulse-dot" />
          {connectionPhase === "connected"
            ? "매칭 서버 연결됨"
            : "연결 동기화 중"}
        </span>
      </div>

      {/* 매칭 오류 배너 (예: ALREADY_MATCHED 등) */}
      {state.error && (
        <div
          className="cbc-error-banner"
          role="alert"
          data-testid="matchmaking-error-banner"
          data-error-code={state.error.code}
          style={{ justifyContent: "space-between" }}
        >
          <span>
            <strong>[{state.error.code}]</strong> {state.error.message}
          </span>
          {onDismissError && (
            <button
              type="button"
              className="cbc-btn-secondary"
              style={{ width: "auto", padding: "0.25rem 0.625rem" }}
              onClick={onDismissError}
            >
              닫기
            </button>
          )}
        </div>
      )}

      {/* 본문 2단 그리드 (Stitch 16_matchmaking 레이아웃) */}
      <div className="cbc-matchmaking-grid">
        {/* 좌측: 실시간 매칭 상태 및 취소 패널 */}
        <section
          className="cbc-matchmaking-main-card"
          aria-label="실시간 매칭 상태"
        >
          <div className="cbc-matchmaking-card-head">
            <span className="cbc-matchmaking-section-label">매칭 상태</span>
            <span className="cbc-chip">
              {isLeaving
                ? "취소 요청 중"
                : isJoining
                  ? "대기열 진입 중"
                  : "상대 탐색 중"}
            </span>
          </div>

          <div
            className="cbc-matchmaking-radar-wrap"
            role="status"
            aria-live="polite"
          >
            <div className="cbc-matchmaking-radar-circle" aria-hidden="true">
              <div className="cbc-matchmaking-radar-ping" />
              <svg
                className="cbc-matchmaking-radar-svg"
                viewBox="0 0 160 160"
              >
                <circle
                  className="cbc-matchmaking-ring-bg"
                  cx="80"
                  cy="80"
                  r="70"
                  fill="none"
                  strokeWidth="6"
                />
                <circle
                  className="cbc-matchmaking-ring-fg"
                  cx="80"
                  cy="80"
                  r="70"
                  fill="none"
                  strokeWidth="6"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringDashOffset}
                  strokeLinecap="round"
                />
              </svg>
              <div className="cbc-matchmaking-radar-center">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
                </svg>
                <span>{isLeaving ? "취소 중" : "탐색 중"}</span>
              </div>
            </div>

            <div className="cbc-matchmaking-status-copy">
              <h2 className="cbc-matchmaking-status-title">{statusHeadline}</h2>
              <p className="cbc-subheading">{catalog.waitingDescription}</p>
            </div>

            <div className="cbc-matchmaking-elapsed-box">
              <span className="cbc-matchmaking-elapsed-label">경과 시간:</span>
              <strong
                className="cbc-matchmaking-elapsed-value"
                data-testid="matchmaking-elapsed-timer"
              >
                {elapsedText}
              </strong>
            </div>
          </div>

          <div className="cbc-matchmaking-meta-grid">
            <div className="cbc-matchmaking-meta-item">
              <span className="cbc-matchmaking-meta-label">매칭 방식</span>
              <strong className="cbc-matchmaking-meta-value">
                동일 게임 1:1 선착순 매칭
              </strong>
            </div>
            <div className="cbc-matchmaking-meta-item">
              <span className="cbc-matchmaking-meta-label">돌 배정 및 시작</span>
              <strong className="cbc-matchmaking-meta-value">
                흑·백 무작위 배정 · 즉시 대국 시작
              </strong>
            </div>
          </div>

          <div className="cbc-matchmaking-actions">
            <button
              type="button"
              className="cbc-btn-secondary cbc-matchmaking-cancel-btn"
              data-testid="cancel-matchmaking-btn"
              disabled={isLeaving}
              onClick={onCancelQueue}
            >
              <span>
                {isLeaving
                  ? "매칭 취소 처리 중..."
                  : "매칭 취소 및 로비로 이동"}
              </span>
            </button>
            <span className="cbc-matchmaking-esc-hint">
              단축키: <kbd>Esc</kbd> 키로 매칭을 취소할 수 있습니다
            </span>
          </div>
        </section>

        {/* 우측: 대국 규칙 안내 + 내 전적 기록 요약 */}
        <aside className="cbc-matchmaking-side" aria-label="대국 규칙 및 내 전적">
          {/* 대국 규칙 안내 카드 */}
          <section className="cbc-matchmaking-side-card">
            <div className="cbc-matchmaking-card-head">
              <span className="cbc-matchmaking-section-label">
                대국 규칙 안내
              </span>
              <span className="cbc-chip">{catalog.ruleBadge}</span>
            </div>

            <div
              className="cbc-matchmaking-board-preview"
              aria-hidden="true"
            >
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 400 140"
                preserveAspectRatio="xMidYMid slice"
              >
                <rect width="400" height="140" fill="#dfc599" />
                <path
                  d="M0,28 L400,28 M0,56 L400,56 M0,84 L400,84 M0,112 L400,112 M60,0 L60,140 M120,0 L120,140 M180,0 L180,140 M240,0 L240,140 M300,0 L300,140 M360,0 L360,140"
                  stroke="#9e7b4e"
                  strokeWidth="1.2"
                  opacity="0.7"
                />
                <circle cx="180" cy="56" r="12" fill="#1c1814" />
                <circle cx="240" cy="56" r="12" fill="#f7f3eb" stroke="#b5a68e" />
                <circle cx="240" cy="84" r="12" fill="#1c1814" />
                <circle cx="180" cy="84" r="12" fill="#f7f3eb" stroke="#b5a68e" />
                <circle cx="120" cy="56" r="12" fill="#1c1814" />
              </svg>
              <div className="cbc-matchmaking-board-preview-caption">
                <span>종목</span>
                <strong>{catalog.title}</strong>
              </div>
            </div>

            <div className="cbc-matchmaking-size-box">
              <span className="cbc-matchmaking-meta-label">보드 크기</span>
              <strong className="cbc-matchmaking-size-value">
                {catalog.boardSizeLabel}
              </strong>
              <span className="cbc-matchmaking-size-sub">
                {catalog.boardSubLabel}
              </span>
            </div>

            <dl className="cbc-matchmaking-rule-list">
              {catalog.rules.map((item) => (
                <div key={item.label} className="cbc-matchmaking-rule-row">
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* 내 전적 기록 요약 카드 */}
          <section
            className="cbc-matchmaking-side-card"
            data-testid="matchmaking-stats-card"
          >
            <div className="cbc-matchmaking-card-head">
              <span className="cbc-matchmaking-section-label">
                내 {catalog.shortTitle} 전적 기록
              </span>
              <span className="cbc-matchmaking-meta-label">
                총 {played}전
              </span>
            </div>

            <div className="cbc-matchmaking-stats-grid">
              <div className="cbc-matchmaking-stat-cell">
                <span>승리</span>
                <strong className="is-primary">{wins}승</strong>
              </div>
              <div className="cbc-matchmaking-stat-cell">
                <span>패배</span>
                <strong>{losses}패</strong>
              </div>
              <div className="cbc-matchmaking-stat-cell">
                <span>무승부</span>
                <strong>{draws}무</strong>
              </div>
              <div className="cbc-matchmaking-stat-cell">
                <span>승률</span>
                <strong data-testid="matchmaking-winrate">
                  {winRateDisplay}
                </strong>
              </div>
            </div>

            <div className="cbc-progress-bar" aria-hidden="true">
              <div
                className="is-win"
                style={{ width: `${winWidthPct}%` }}
              />
              <div
                className="is-draw"
                style={{ width: `${drawWidthPct}%` }}
              />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
