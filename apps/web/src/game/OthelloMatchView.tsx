import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PlayerId } from "@cafe/game-contracts";
import { formatRemainingGraceTime } from "./gomoku-state.ts";
import {
  OTHELLO_BOARD_SIZE,
  OTHELLO_COORDS,
  countOthelloDiscs,
  createInitialOthelloBoard,
  deriveOthelloTurnPresentation,
  describeOthelloResult,
  type OthelloClientState,
} from "./othello-state.ts";

/** 오델로 대국 화면 컴포넌트 Props */
export interface OthelloMatchViewProps {
  state: OthelloClientState;
  viewerNickname?: string;
  playerNicknames?: Readonly<Record<number, string>>;
  onPlaceDisc: (row: number, col: number) => void;
  onResign: () => void;
  onReconnect: () => void;
  onDismissError?: () => void;
  onPlayAgain?: () => void;
  onBackToLobby: () => void;
}

/**
 * 플레이어 ID를 화면 표시용 이름 문자열로 변환합니다.
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
 * 서버가 확정한 OthelloSnapshot만 표시하고 승패를 직접 판정하지 않는 8×8 오델로 대국 화면 컴포넌트입니다.
 * (SRS FR-G2-01~FR-G2-05, IF-01, IF-05, SDS 2.2 `16_othello_board`~`18_othello_result`)
 */
export function OthelloMatchView({
  state,
  viewerNickname,
  playerNicknames,
  onPlaceDisc,
  onResign,
  onReconnect,
  onDismissError,
  onPlayAgain,
  onBackToLobby,
}: OthelloMatchViewProps) {
  const [resignModalOpen, setResignModalOpen] = useState(false);
  const [resultOverlayMinimized, setResultOverlayMinimized] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resignTriggerBtnRef = useRef<HTMLButtonElement | null>(null);

  const { snapshot, viewerUserId, lastMove, gameError, connectionPhase } =
    state;

  // 기권 확인 모달이 열려 있을 때 Escape 키로 닫고 기권 버튼으로 포커스를 복원합니다 (NFR-UX-02).
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

  useEffect(() => {
    setResultOverlayMinimized(false);
  }, [snapshot?.matchId, snapshot?.status]);

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

  const board = snapshot?.board ?? createInitialOthelloBoard();
  const discCounts = countOthelloDiscs(board);
  const turn = deriveOthelloTurnPresentation(state);
  const resultPresentation = describeOthelloResult(snapshot, viewerUserId);
  const isFinished = snapshot?.status === "finished";

  const legalMoveMap = new Map<string, number>();
  for (const move of turn.legalMoves) {
    legalMoveMap.set(`${move.row},${move.col}`, move.flipCount);
  }

  const flippedCoordSet = new Set<string>();
  if (lastMove) {
    for (const coord of lastMove.flippedCoords) {
      flippedCoordSet.add(`${coord.row},${coord.col}`);
    }
  }

  const blackPlayerId = snapshot?.players.black ?? null;
  const whitePlayerId = snapshot?.players.white ?? null;
  const currentTurnPlayerId = snapshot?.currentPlayerId ?? null;

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
    if (!turn.canPlaceDisc) return;
    if ((board[row]?.[col] ?? null) !== null) return;
    onPlaceDisc(row, col);
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
      nextCol = Math.min(OTHELLO_BOARD_SIZE - 1, col + 1);
    } else if (event.key === "ArrowUp") {
      nextRow = Math.max(0, row - 1);
    } else if (event.key === "ArrowDown") {
      nextRow = Math.min(OTHELLO_BOARD_SIZE - 1, row + 1);
    } else if (event.key === "Home") {
      if (event.ctrlKey) {
        nextRow = 0;
      }
      nextCol = 0;
    } else if (event.key === "End") {
      if (event.ctrlKey) {
        nextRow = OTHELLO_BOARD_SIZE - 1;
      }
      nextCol = OTHELLO_BOARD_SIZE - 1;
    } else {
      return;
    }
    event.preventDefault();
    const targetIndex = nextRow * OTHELLO_BOARD_SIZE + nextCol;
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
    <div className="cbc-gomoku-page" data-testid="othello-match-view">
      {/* 1. 자신의 WebSocket 연결 상태 배너 */}
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
                재접속이 완료되면 서버의 최신 오델로 대국 상태를 자동으로 복구합니다.
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
                [세션 전환됨] 다른 기기 또는 브라우저 탭에서 대국 제어권을 가져갔습니다
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
                  상대방의 네트워크 연결이 불안정하여 대국이 일시정지되었습니다. 누적 유예 시간(60초) 내 복귀하지 않으면 시간패 처리됩니다.
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

      {/* 4. 자동 패스 발생 안내 배너 (FR-G2-03) */}
      {turn.autoPassNotice && (
        <section
          className="cbc-othello-autopass-banner"
          role="status"
          aria-live="polite"
          data-testid="othello-auto-pass-banner"
        >
          <span className="cbc-chip">자동 패스</span>
          <span>{turn.autoPassNotice}</span>
        </section>
      )}

      {/* 5. 서버 game.error 알림 배너 */}
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

      {/* 6. 상단 대국 요약 바 (현재 차례 · 최근 착수 및 뒤집힌 돌 수 표시) */}
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
                {lastMove.flippedCoords.length > 0 && (
                  <> · 뒤집기 {lastMove.flippedCoords.length}개</>
                )}
              </span>
            </>
          ) : (
            <span>중앙 4칸 초기 배치 완료 · 흑돌 선공</span>
          )}
        </div>
      </section>

      {/* 7. 메인 대국 레이아웃 (좌측 플레이어/돌 개수 스코어보드/조작 패널 + 우측 8×8 오델로 보드) */}
      <div className="cbc-gomoku-layout">
        <aside className="cbc-gomoku-sidebar">
          {/* 실시간 돌 개수 비교 스코어보드 (FR-G2-05) */}
          <section
            className="cbc-match-info-card cbc-othello-score-card"
            data-testid="othello-scoreboard"
          >
            <div className="cbc-othello-score-header">
              <span className="cbc-eyebrow">실시간 돌 개수 현황</span>
              <span className="cbc-othello-empty-count">
                빈 칸 {discCounts.empty} / 64
              </span>
            </div>
            <div className="cbc-othello-score-row">
              <div className="cbc-othello-score-side">
                <span className="cbc-stone-badge is-black" aria-hidden="true" />
                <div>
                  <span className="cbc-othello-score-label">흑돌</span>
                  <strong
                    className="cbc-othello-score-num"
                    data-testid="othello-disc-count-black"
                  >
                    {discCounts.black}
                  </strong>
                </div>
              </div>
              <span className="cbc-othello-score-vs">:</span>
              <div className="cbc-othello-score-side is-right">
                <div>
                  <span className="cbc-othello-score-label">백돌</span>
                  <strong
                    className="cbc-othello-score-num"
                    data-testid="othello-disc-count-white"
                  >
                    {discCounts.white}
                  </strong>
                </div>
                <span className="cbc-stone-badge is-white" aria-hidden="true" />
              </div>
            </div>
          </section>

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
                    흑돌 (선공) · 현재 {discCounts.black}개
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
                    백돌 (후공) · 현재 {discCounts.white}개
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

          {/* 대국 조작 버튼 영역 */}
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

        {/* 우측 8×8 오델로 보드 영역 (row/col 0..7) */}
        <section className="cbc-gomoku-board-stage" aria-label="8×8 오델로 보드">
          <div className="cbc-othello-felt-frame">
            {/* 상단 열(col: 0..7) 인덱스 헤더 */}
            <div className="cbc-othello-col-headers" aria-hidden="true">
              <span className="cbc-othello-corner-spacer" />
              {OTHELLO_COORDS.map((col) => (
                <span
                  key={`othello-col-header-${col}`}
                  className="cbc-othello-coord-label"
                  data-col-header={col}
                >
                  {col}
                </span>
              ))}
            </div>

            <div className="cbc-othello-board-body">
              <div className="cbc-othello-row-headers" aria-hidden="true">
                {OTHELLO_COORDS.map((row) => (
                  <span
                    key={`othello-row-header-${row}`}
                    className="cbc-othello-coord-label"
                    data-row-header={row}
                  >
                    {row}
                  </span>
                ))}
              </div>

              <div className="cbc-othello-grid" role="grid" aria-label="8×8 오델로 격자">
                {OTHELLO_COORDS.map((row) => (
                  <div
                    key={`othello-row-${row}`}
                    className="cbc-othello-row"
                    role="row"
                    data-row-index={row}
                  >
                    {OTHELLO_COORDS.map((col) => {
                      const cell = board[row]?.[col] ?? null;
                      const coordKey = `${row},${col}`;
                      const flipCount = legalMoveMap.get(coordKey) ?? 0;
                      const isLegalMove = cell === null && flipCount > 0;
                      const isLastMove =
                        lastMove !== null &&
                        lastMove.row === row &&
                        lastMove.col === col;
                      const isFlipped = flippedCoordSet.has(coordKey);
                      const isDisabled = cell !== null || !turn.canPlaceDisc;

                      const discDescription =
                        cell === "black"
                          ? `흑돌${isLastMove ? " (최근 착수)" : isFlipped ? " (뒤집힘)" : ""}`
                          : cell === "white"
                            ? `백돌${isLastMove ? " (최근 착수)" : isFlipped ? " (뒤집힘)" : ""}`
                            : isLegalMove && turn.isMyTurn
                              ? `착수 가능 (상대 돌 ${flipCount}개 뒤집기)`
                              : "빈 칸";

                      return (
                        <button
                          key={`othello-cell-${row}-${col}`}
                          ref={(node) => {
                            cellRefs.current[row * OTHELLO_BOARD_SIZE + col] =
                              node;
                          }}
                          type="button"
                          className={`cbc-othello-cell ${
                            cell ? `has-${cell}` : "is-empty"
                          } ${isLegalMove && turn.isMyTurn ? "is-legal-move" : ""} ${
                            isLastMove ? "is-last-move" : ""
                          } ${isFlipped ? "is-flipped" : ""}`}
                          data-row={row}
                          data-col={col}
                          data-cell-state={cell ?? "empty"}
                          data-legal-move={isLegalMove ? "true" : undefined}
                          data-flip-count={isLegalMove ? flipCount : undefined}
                          data-last-move={isLastMove ? "true" : undefined}
                          data-flipped-disc={isFlipped ? "true" : undefined}
                          aria-label={`${row}, ${col} ${discDescription}`}
                          disabled={isDisabled}
                          onKeyDown={(event) =>
                            handleCellKeyDown(event, row, col)
                          }
                          onClick={() => handleCellClick(row, col)}
                        >
                          {/* 내 차례일 때 합법 착수 위치 가이드 점 표시 */}
                          {cell === null && isLegalMove && turn.isMyTurn && (
                            <span
                              className="cbc-othello-legal-dot"
                              aria-hidden="true"
                            >
                              {flipCount}
                            </span>
                          )}

                          {/* 서버 snapshot에 확정된 오델로 디스크 렌더링 */}
                          {cell !== null && (
                            <span
                              className={`cbc-othello-disc ${
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

            {/* 8. 보드 위 종료 결과 오버레이 (snapshot.status === "finished" && snapshot.result !== null 일 때만 표시) */}
            {resultPresentation && !resultOverlayMinimized && (
              <div
                className="cbc-board-result-overlay"
                role="dialog"
                aria-modal="false"
                aria-labelledby="othello-result-headline"
                data-testid="othello-result-panel"
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
                    id="othello-result-headline"
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

            {resultPresentation && resultOverlayMinimized && (
              <div
                className="cbc-board-result-minimized-bar"
                data-testid="othello-result-minimized-bar"
              >
                <strong>
                  {resultPresentation.headline} ({resultPresentation.subheadline})
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

      {/* 9. 기권 확인 모달 */}
      {resignModalOpen && (
        <div
          className="cbc-modal-backdrop"
          onClick={() => {
            setResignModalOpen(false);
            resignTriggerBtnRef.current?.focus();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="othello-resign-dialog-title"
            aria-describedby="othello-resign-dialog-desc"
            className="cbc-modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="othello-resign-dialog-title"
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "22px",
                margin: "0 0 0.5rem",
              }}
            >
              정말 기권하시겠습니까?
            </h3>
            <p
              id="othello-resign-dialog-desc"
              className="cbc-subheading"
              style={{ maxWidth: "320px" }}
            >
              기권하면 즉시 패배(resign)로 기록되며 상대방의 승리로 대국이
              종료됩니다.
            </p>
            <div className="cbc-modal-actions">
              <button
                type="button"
                className="cbc-btn-secondary"
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
