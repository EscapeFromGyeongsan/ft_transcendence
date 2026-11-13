import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PlayerId } from "@cafe/game-contracts";
import { useDialogFocus } from "../ui/use-dialog-focus.ts";
import {
  GOMOKU_BOARD_SIZE,
  GOMOKU_COORDS,
  countPlacedStones,
  createEmptyGomokuBoard,
  deriveTurnPresentation,
  describeGomokuResult,
  formatRemainingGraceTime,
  getCurrentTurnPlayerId,
  isGomokuStarPoint,
  type GomokuClientState,
} from "./gomoku-state.ts";

/** 오목 대국 화면 컴포넌트 Props */
export interface GomokuMatchViewProps {
  state: GomokuClientState;
  viewerNickname?: string;
  playerNicknames?: Readonly<Record<number, string>>;
  onPlaceStone: (row: number, col: number) => void;
  onResign: () => void;
  onReconnect: () => void;
  onDismissError?: () => void;
  onPlayAgain?: () => void;
  onBackToLobby: () => void;
}

/**
 * 플레이어 ID를 화면 표시용 이름 문자열로 변환합니다.
 * `GET /api/users/:userId`로 조회된 닉네임이 있으면 우선 표시합니다.
 */
function formatPlayerLabel(
  playerId: PlayerId | null,
  viewerUserId: PlayerId | null,
  viewerNickname?: string,
  playerNicknames?: Readonly<Record<number, string>>,
): string {
  if (playerId === null) {
    return "대기 중";
  }
  const resolvedNickname =
    playerNicknames?.[playerId]?.trim() ||
    (viewerUserId !== null && playerId === viewerUserId
      ? viewerNickname?.trim()
      : undefined);

  if (viewerUserId !== null && playerId === viewerUserId) {
    return resolvedNickname
      ? `${resolvedNickname} (나)`
      : `Player #${playerId} (나)`;
  }
  return resolvedNickname || `Player #${playerId}`;
}

/**
 * 서버가 확정한 GomokuSnapshot만 표시하고 승패를 직접 계산하지 않는 15×15 오목 대국 화면 컴포넌트입니다.
 * (IF-01, IF-05 준수)
 */
export function GomokuMatchView({
  state,
  viewerNickname,
  playerNicknames,
  onPlaceStone,
  onResign,
  onReconnect,
  onDismissError,
  onPlayAgain,
  onBackToLobby,
}: GomokuMatchViewProps) {
  const [resignModalOpen, setResignModalOpen] = useState(false);
  const [resultOverlayMinimized, setResultOverlayMinimized] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resignTriggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const resignDialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(resignModalOpen, resignDialogRef, "[data-dialog-cancel]");

  const { snapshot, viewerUserId, lastMove, gameError, connectionPhase } =
    state;

  // 기권 확인 모달이 열려 있을 때 Escape 키로 닫고 기권 버튼으로 포커스를 되돌립니다 (NFR-UX-02).
  useEffect(() => {
    if (!resignModalOpen || typeof globalThis.window === "undefined") {
      return undefined;
    }
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setResignModalOpen(false);
        resignTriggerBtnRef.current?.focus();
      }
    }
    globalThis.window.addEventListener("keydown", handleWindowKeyDown);
    return () =>
      globalThis.window.removeEventListener("keydown", handleWindowKeyDown);
  }, [resignModalOpen]);

  const isOpponentDisconnected = Boolean(
    state.opponentDisconnect || snapshot?.status === "paused",
  );

  // 새 대국이 시작되거나 종료 상태가 바뀌면 결과 오버레이를 기본 표시 상태로 초기화합니다.
  useEffect(() => {
    setResultOverlayMinimized(false);
  }, [snapshot?.matchId, snapshot?.status]);

  // 상대방 연결 끊김 시 남은 유예 시간 카운트다운 표시용 타이머 (승패 판정은 절대 클라이언트에서 하지 않음)
  useEffect(() => {
    if (!state.opponentDisconnect) {
      return;
    }
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => clearInterval(timer);
  }, [state.opponentDisconnect]);

  const elapsedDisconnectMs = state.opponentDisconnect
    ? Math.max(0, nowMs - state.opponentDisconnect.receivedAtMs)
    : 0;
  const remainingDisconnectMs = state.opponentDisconnect
    ? Math.max(0, state.opponentDisconnect.remainingMs - elapsedDisconnectMs)
    : 60_000;
  const graceTime = formatRemainingGraceTime(remainingDisconnectMs);

  const board = snapshot?.board ?? createEmptyGomokuBoard();
  const stoneCounts = countPlacedStones(board);
  const turn = deriveTurnPresentation(state);
  const resultPresentation = describeGomokuResult(snapshot, viewerUserId);
  const isFinished = snapshot?.status === "finished";

  const blackPlayerId = snapshot?.players.black ?? null;
  const whitePlayerId = snapshot?.players.white ?? null;
  const currentTurnPlayerId = getCurrentTurnPlayerId(snapshot ?? null);

  const isBlackTurn =
    snapshot?.status === "playing" &&
    blackPlayerId !== null &&
    currentTurnPlayerId === blackPlayerId;
  const isWhiteTurn =
    snapshot?.status === "playing" &&
    whitePlayerId !== null &&
    currentTurnPlayerId === whitePlayerId;

  const isBlackOpponentDisconnected = Boolean(
    isOpponentDisconnected &&
    blackPlayerId !== null &&
    (state.opponentDisconnect?.userId === blackPlayerId ||
      (state.opponentDisconnect === null &&
        viewerUserId !== null &&
        blackPlayerId !== viewerUserId)),
  );
  const isWhiteOpponentDisconnected = Boolean(
    isOpponentDisconnected &&
    whitePlayerId !== null &&
    (state.opponentDisconnect?.userId === whitePlayerId ||
      (state.opponentDisconnect === null &&
        viewerUserId !== null &&
        whitePlayerId !== viewerUserId)),
  );

  const showOwnConnectionBanner =
    connectionPhase === "reconnecting" ||
    connectionPhase === "disconnected" ||
    connectionPhase === "connecting" ||
    connectionPhase === "authenticating";

  function handleCellClick(row: number, col: number) {
    if (!turn.canPlaceStone) return;
    if ((board[row]?.[col] ?? null) !== null) return;
    onPlaceStone(row, col);
  }

  function handleCellKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number,
  ) {
    let nextRow = row;
    let nextCol = col;
    if (event.key === "ArrowLeft") {
      nextCol = Math.max(0, col - 1);
    } else if (event.key === "ArrowRight") {
      nextCol = Math.min(GOMOKU_BOARD_SIZE - 1, col + 1);
    } else if (event.key === "ArrowUp") {
      nextRow = Math.max(0, row - 1);
    } else if (event.key === "ArrowDown") {
      nextRow = Math.min(GOMOKU_BOARD_SIZE - 1, row + 1);
    } else if (event.key === "Home") {
      if (event.ctrlKey) {
        nextRow = 0;
      }
      nextCol = 0;
    } else if (event.key === "End") {
      if (event.ctrlKey) {
        nextRow = GOMOKU_BOARD_SIZE - 1;
      }
      nextCol = GOMOKU_BOARD_SIZE - 1;
    } else {
      return;
    }
    event.preventDefault();
    const targetIndex = nextRow * GOMOKU_BOARD_SIZE + nextCol;
    cellRefs.current[targetIndex]?.focus();
  }

  function handleConfirmResign() {
    setResignModalOpen(false);
    onResign();
  }

  function handlePlayAgainClick() {
    if (onPlayAgain) {
      onPlayAgain();
      return;
    }
    onBackToLobby();
  }

  return (
    <div className="cbc-gomoku-page" data-testid="gomoku-match-view">
      {/* 1. 자신의 WebSocket 연결 끊김 / 재접속 중 배너 */}
      {showOwnConnectionBanner && (
        <section
          className={`cbc-conn-banner ${
            connectionPhase === "disconnected"
              ? "is-disconnected"
              : "is-reconnecting"
          }`}
          role={connectionPhase === "disconnected" ? "alert" : "status"}
          aria-live="polite"
          data-testid="connection-status-banner"
          data-connection-phase={connectionPhase}
        >
          <div className="cbc-conn-banner-main">
            <span className="cbc-conn-spinner" aria-hidden="true" />
            <div>
              <div className="cbc-conn-banner-title">
                {connectionPhase === "disconnected"
                  ? "연결 끊김 — 실시간 서버와의 연결이 끊어졌습니다"
                  : connectionPhase === "reconnecting"
                    ? `연결 끊김 · 재접속 중... (재시도 ${Math.max(1, state.reconnectAttempt)}회)`
                    : "실시간 대국 서버 연결 및 인증 확인 중..."}
              </div>
              <div className="cbc-conn-banner-desc">
                재접속이 완료되면 서버의 최신 대국 상태를 자동으로 복구합니다.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cbc-btn-secondary cbc-conn-retry-btn"
            onClick={onReconnect}
          >
            지금 재접속
          </button>
        </section>
      )}

      {/* 2. 세션 대체(session.replaced) 배너 */}
      {state.sessionReplaced && (
        <section
          className="cbc-conn-banner is-disconnected"
          role="alert"
          data-testid="session-replaced-banner"
        >
          <div className="cbc-conn-banner-main">
            <div>
              <div className="cbc-conn-banner-title">
                [세션 전환됨] 다른 기기 또는 브라우저 탭에서 대국 제어권을
                가져갔습니다
              </div>
              <div className="cbc-conn-banner-desc">
                현재 탭에서는 착수 및 기권 조작이 비활성화되었습니다.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cbc-btn-secondary cbc-conn-retry-btn"
            onClick={onReconnect}
          >
            이 탭으로 다시 연결
          </button>
        </section>
      )}

      {/* 3. 상대방 연결 끊김 / 경기 일시정지 배너 */}
      {isOpponentDisconnected && !isFinished && (
        <section
          className="cbc-pause-banner"
          role="status"
          aria-live="polite"
          data-testid="opponent-disconnect-banner"
        >
          <div className="cbc-pause-banner-row">
            <div className="cbc-pause-banner-info">
              <div className="cbc-pause-icon-box" aria-hidden="true">
                !
              </div>
              <div>
                <div className="cbc-pause-title-row">
                  <span className="cbc-pause-badge">경기 일시정지</span>
                  <strong className="cbc-pause-title">
                    상대방 연결 끊김 — 재접속 대기 중
                  </strong>
                </div>
                <p className="cbc-pause-desc">
                  상대방의 네트워크 연결이 불안정하여 대국이 일시정지되었습니다.
                  누적 유예 시간(60초) 내 복귀하지 않으면 시간패 처리됩니다.
                </p>
              </div>
            </div>

            <div className="cbc-pause-timer-box">
              <span className="cbc-pause-timer-label">남은 유예 시간</span>
              <span
                className="cbc-pause-timer-value"
                data-testid="disconnect-remaining-time"
              >
                {graceTime.mmss}
              </span>
              <span className="cbc-pause-timer-sub">
                ({graceTime.seconds}초 / 누적 60초)
              </span>
            </div>
          </div>

          <div className="cbc-pause-progress-track" aria-hidden="true">
            <div
              className="cbc-pause-progress-bar"
              style={{ width: `${graceTime.progressPercent}%` }}
            />
          </div>
        </section>
      )}

      {/* 4. 서버 game.error 알림 배너 */}
      {gameError && (
        <section
          className="cbc-game-error-banner"
          role="alert"
          data-testid="game-error-banner"
          data-error-code={gameError.code}
        >
          <div className="cbc-game-error-content">
            <span className="cbc-game-error-code">{gameError.code}</span>
            <span className="cbc-game-error-message">{gameError.message}</span>
          </div>
          {onDismissError && (
            <button
              type="button"
              className="cbc-game-error-close"
              aria-label="오류 알림 닫기"
              onClick={onDismissError}
            >
              닫기
            </button>
          )}
        </section>
      )}

      {/* 5. 상단 대국 요약 바 (현재 차례 · 최근 착수 표시) */}
      <section className="cbc-gomoku-statusbar" aria-label="대국 진행 상태">
        <div
          className={`cbc-gomoku-turn-banner ${
            turn.isMyTurn
              ? "is-my-turn"
              : turn.isOpponentTurn
                ? "is-opponent-turn"
                : ""
          }`}
          data-testid="turn-indicator"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {turn.currentTurnColor && (
            <span
              className={`cbc-stone-dot ${
                turn.currentTurnColor === "white" ? "is-white" : "is-black"
              }`}
              aria-hidden="true"
            />
          )}
          <strong>{turn.turnLabel}</strong>
          <span className="cbc-gomoku-turn-sub">{turn.turnDescription}</span>
        </div>

        <div
          className="cbc-gomoku-lastmove-pill"
          data-testid="last-move-indicator"
        >
          {lastMove ? (
            <>
              <span
                className={`cbc-stone-dot ${
                  lastMove.color === "white" ? "is-white" : "is-black"
                }`}
                aria-hidden="true"
              />
              <span>
                {lastMove.isOpponentMove ? "상대 착수" : "내 착수"}:{" "}
                <strong>
                  ({lastMove.row}, {lastMove.col})
                </strong>
              </span>
            </>
          ) : (
            <span>첫 착수를 기다리고 있습니다</span>
          )}
        </div>
      </section>

      {/* 6. 메인 대국 레이아웃 (좌측 플레이어/조작 패널 + 우측 15×15 오목판) */}
      <div className="cbc-gomoku-layout">
        {/* 좌측 플레이어 및 대국 제어 패널 */}
        <aside className="cbc-gomoku-sidebar">
          {/* 흑돌(선공) 플레이어 카드 */}
          <article
            className={`cbc-player-card ${isBlackTurn ? "is-active-turn" : ""}`}
            data-testid="player-card-black"
          >
            <div className="cbc-player-card-header">
              <div className="cbc-player-identity">
                <span className="cbc-stone-badge is-black" aria-hidden="true" />
                <div>
                  <div className="cbc-player-name">
                    {formatPlayerLabel(
                      blackPlayerId,
                      viewerUserId,
                      viewerNickname,
                      playerNicknames,
                    )}
                  </div>
                  <div className="cbc-player-role-sub">
                    흑돌 (선공) · 착수 {stoneCounts.black}회
                  </div>
                </div>
              </div>

              {isFinished ? (
                <span className="cbc-turn-chip">[종료]</span>
              ) : isBlackOpponentDisconnected ? (
                <span className="cbc-turn-chip is-disconnected">
                  [재접속 대기 중]
                </span>
              ) : isBlackTurn ? (
                <span className="cbc-turn-chip is-active">
                  {blackPlayerId === viewerUserId
                    ? "[현재 차례 · 내 차례]"
                    : "[상대 차례]"}
                </span>
              ) : (
                <span className="cbc-turn-chip">[대기]</span>
              )}
            </div>
          </article>

          {/* 백돌(후공) 플레이어 카드 */}
          <article
            className={`cbc-player-card ${isWhiteTurn ? "is-active-turn" : ""}`}
            data-testid="player-card-white"
          >
            <div className="cbc-player-card-header">
              <div className="cbc-player-identity">
                <span className="cbc-stone-badge is-white" aria-hidden="true" />
                <div>
                  <div className="cbc-player-name">
                    {formatPlayerLabel(
                      whitePlayerId,
                      viewerUserId,
                      viewerNickname,
                      playerNicknames,
                    )}
                  </div>
                  <div className="cbc-player-role-sub">
                    백돌 (후공) · 착수 {stoneCounts.white}회
                  </div>
                </div>
              </div>

              {isFinished ? (
                <span className="cbc-turn-chip">[종료]</span>
              ) : isWhiteOpponentDisconnected ? (
                <span className="cbc-turn-chip is-disconnected">
                  [재접속 대기 중]
                </span>
              ) : isWhiteTurn ? (
                <span className="cbc-turn-chip is-active">
                  {whitePlayerId === viewerUserId
                    ? "[현재 차례 · 내 차례]"
                    : "[상대 차례]"}
                </span>
              ) : (
                <span className="cbc-turn-chip">[대기]</span>
              )}
            </div>
          </article>

          {/* 대국 조작 버튼 영역 (기권 / 다시 하기 / 나가기 단일화) */}
          <section className="cbc-match-info-card">
            <div className="cbc-match-actions">
              {!isFinished ? (
                <button
                  ref={resignTriggerBtnRef}
                  type="button"
                  className="cbc-btn-resign"
                  disabled={!turn.canResign}
                  data-testid="resign-trigger-btn"
                  onClick={() => setResignModalOpen(true)}
                >
                  기권하기
                </button>
              ) : (
                onPlayAgain && (
                  <button
                    type="button"
                    className="cbc-btn-primary"
                    onClick={handlePlayAgainClick}
                  >
                    다시 하기
                  </button>
                )
              )}

              <button
                type="button"
                className="cbc-btn-secondary"
                data-testid="leave-match-btn"
                onClick={onBackToLobby}
              >
                나가기
              </button>
            </div>
          </section>
        </aside>

        {/* 우측 15×15 오목 보드 영역 (row/col 0..14) */}
        <section
          className="cbc-gomoku-board-stage"
          aria-label="15×15 오목 보드"
        >
          <div className="cbc-gomoku-wood-frame">
            {/* 상단 열(col: 0..14) 인덱스 헤더 */}
            <div className="cbc-gomoku-col-headers" aria-hidden="true">
              <span className="cbc-gomoku-corner-spacer" />
              {GOMOKU_COORDS.map((col) => (
                <span
                  key={`col-header-${col}`}
                  className="cbc-gomoku-coord-label"
                  data-col-header={col}
                >
                  {col}
                </span>
              ))}
            </div>

            {/* 좌측 행(row: 0..14) 헤더 + 우측 연속 SVG 격자 및 15×15 교차점 그리드 */}
            <div className="cbc-gomoku-board-body">
              <div className="cbc-gomoku-row-headers" aria-hidden="true">
                {GOMOKU_COORDS.map((row) => (
                  <span
                    key={`row-header-${row}`}
                    className="cbc-gomoku-coord-label cbc-gomoku-row-label"
                    data-row-header={row}
                  >
                    {row}
                  </span>
                ))}
              </div>

              <div className="cbc-gomoku-grid-area">
                {/* 15개의 가로선과 15개의 세로선을 끊김 없이 일정한 굵기·진하기로 그리는 연속 SVG 격자 */}
                <svg
                  className="cbc-gomoku-grid-svg"
                  viewBox="0 0 1500 1500"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {GOMOKU_COORDS.map((index) => {
                    const pos = 50 + index * 100;
                    return (
                      <g key={`grid-line-${index}`}>
                        <line
                          x1={50}
                          y1={pos}
                          x2={1450}
                          y2={pos}
                          stroke="#4a341b"
                          strokeWidth={1.5}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={pos}
                          y1={50}
                          x2={pos}
                          y2={1450}
                          stroke="#4a341b"
                          strokeWidth={1.5}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })}
                </svg>

                {/* 행(row: 0..14) 및 열(col: 0..14) 225개 교차점 버튼 */}
                <div className="cbc-gomoku-rows-wrap">
                  {GOMOKU_COORDS.map((row) => (
                    <div
                      key={`board-row-${row}`}
                      className="cbc-gomoku-row-cells"
                      role="group"
                      aria-label={`${row}행 교차점`}
                      data-row-index={row}
                    >
                      {GOMOKU_COORDS.map((col) => {
                        const cell = board[row]?.[col] ?? null;
                        const isLastMove =
                          lastMove !== null &&
                          lastMove.row === row &&
                          lastMove.col === col;
                        const isStar = isGomokuStarPoint(row, col);
                        const isDisabled = cell !== null || !turn.canPlaceStone;

                        const stoneDescription =
                          cell === "black"
                            ? `흑돌${isLastMove ? " (최근 착수)" : ""}`
                            : cell === "white"
                              ? `백돌${isLastMove ? " (최근 착수)" : ""}`
                              : "빈 칸";

                        return (
                          <button
                            key={`cell-${row}-${col}`}
                            ref={(node) => {
                              cellRefs.current[row * GOMOKU_BOARD_SIZE + col] =
                                node;
                            }}
                            type="button"
                            className={`cbc-gomoku-cell ${
                              cell ? `has-${cell}` : "is-empty"
                            } ${isLastMove ? "is-last-move" : ""}`}
                            data-row={row}
                            data-col={col}
                            data-cell-state={cell ?? "empty"}
                            data-last-move={isLastMove ? "true" : undefined}
                            aria-label={`${row}, ${col} ${stoneDescription}`}
                            disabled={isDisabled}
                            onKeyDown={(event) =>
                              handleCellKeyDown(event, row, col)
                            }
                            onClick={() => handleCellClick(row, col)}
                          >
                            {/* 화점(별점) 표시 */}
                            {cell === null && isStar && (
                              <span
                                className="cbc-gomoku-star-dot"
                                aria-hidden="true"
                              />
                            )}

                            {/* 서버 snapshot에 확정된 돌 렌더링 */}
                            {cell !== null && (
                              <span
                                className={`cbc-gomoku-stone ${
                                  cell === "black" ? "is-black" : "is-white"
                                }`}
                              >
                                {isLastMove && (
                                  <span
                                    className="cbc-gomoku-last-marker"
                                    aria-hidden="true"
                                  />
                                )}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 7. 보드 위 간단한 종료 결과 오버레이 (snapshot.status === "finished" && snapshot.result !== null 일 때만 표시) */}
            {resultPresentation && !resultOverlayMinimized && (
              <div
                className="cbc-board-result-overlay"
                role="dialog"
                aria-modal="false"
                aria-labelledby="gomoku-result-headline"
                data-testid="gomoku-result-panel"
                data-result-outcome={resultPresentation.outcome}
                data-result-reason={resultPresentation.reason}
              >
                <div className="cbc-board-result-card">
                  <span
                    className={`cbc-result-badge is-${resultPresentation.perspective}`}
                  >
                    {resultPresentation.badgeText}
                  </span>
                  <h2
                    id="gomoku-result-headline"
                    className="cbc-result-headline"
                  >
                    {resultPresentation.headline}
                  </h2>
                  <p
                    className="cbc-result-subheadline"
                    data-testid="result-reason-title"
                  >
                    {resultPresentation.subheadline}
                  </p>

                  <div className="cbc-board-result-actions">
                    <button
                      type="button"
                      className="cbc-btn-primary"
                      data-testid="result-play-again-btn"
                      onClick={handlePlayAgainClick}
                    >
                      다시 하기
                    </button>
                    <button
                      type="button"
                      className="cbc-btn-secondary"
                      data-testid="result-leave-btn"
                      onClick={onBackToLobby}
                    >
                      나가기
                    </button>
                  </div>

                  <button
                    type="button"
                    className="cbc-board-result-minimize"
                    data-testid="result-minimize-btn"
                    onClick={() => setResultOverlayMinimized(true)}
                  >
                    마지막 판 다시 보기
                  </button>
                </div>
              </div>
            )}

            {/* 결과 오버레이를 최소화했을 때 다시 열 수 있는 플로팅 바 */}
            {resultPresentation && resultOverlayMinimized && (
              <div
                className="cbc-board-result-minimized-bar"
                data-testid="gomoku-result-minimized-bar"
              >
                <strong>
                  {resultPresentation.headline} (
                  {resultPresentation.reasonTitle})
                </strong>
                <div className="cbc-board-result-minimized-actions">
                  <button
                    type="button"
                    className="cbc-btn-secondary"
                    onClick={() => setResultOverlayMinimized(false)}
                  >
                    결과 창 열기
                  </button>
                  <button
                    type="button"
                    className="cbc-btn-primary"
                    onClick={handlePlayAgainClick}
                  >
                    다시 하기
                  </button>
                  <button
                    type="button"
                    className="cbc-btn-secondary"
                    onClick={onBackToLobby}
                  >
                    나가기
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 8. 기권 확인 모달 */}
      {resignModalOpen && (
        <div
          className="cbc-modal-backdrop"
          onClick={() => setResignModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resign-dialog-title"
            aria-describedby="resign-dialog-desc"
            className="cbc-modal-dialog"
            ref={resignDialogRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="resign-dialog-title"
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "22px",
                margin: "0 0 0.5rem",
              }}
            >
              정말 기권하시겠습니까?
            </h3>
            <p
              id="resign-dialog-desc"
              className="m-0 text-sm/5 text-on-surface-variant"
              style={{ maxWidth: "340px" }}
            >
              기권 명령(resign)을 전송하면 서버가 즉시 상대방의 승리로 대국을
              종료합니다.
            </p>
            <div className="cbc-modal-actions">
              <button
                type="button"
                className="cbc-btn-secondary"
                data-dialog-cancel
                onClick={() => {
                  setResignModalOpen(false);
                  resignTriggerBtnRef.current?.focus();
                }}
              >
                취소
              </button>
              <button
                type="button"
                className="cbc-btn-danger"
                data-testid="confirm-resign-btn"
                onClick={handleConfirmResign}
              >
                기권 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
