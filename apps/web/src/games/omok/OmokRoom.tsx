import { useEffect, useRef, useState } from "react";
import { Board, coordinate } from "./Board";
import type { LocalOmokSession } from "./useLocalOmok";
import { ConfirmDialog } from "../../components/ConfirmDialog";

export function OmokRoom({ session }: { session: LocalOmokSession }) {
  const { game, error, place, reset, resign } = session;
  const [confirm, setConfirm] = useState<"reset" | "resign" | null>(null);
  const history = useRef<HTMLDivElement>(null);
  const result = game.result;
  const current = game.currentTurn === "black" ? "흑" : "백";
  const title = result
    ? result.kind === "draw"
      ? "좋은 승부였어요, 무승부!"
      : `${result.winner === "black" ? "흑" : "백"}돌의 승리!`
    : `${current}돌의 차례예요`;
  useEffect(() => {
    if (history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [game.moves.length]);
  return (
    <>
      <div className="room-heading">
        <div>
          <div className="eyebrow">LOCAL TABLE / 01</div>
          <h1>
            오목 <span className="tag">로컬 대전</span>
          </h1>
          <p>마주 앉은 두 사람, 다섯 개의 돌로 이어지는 승부.</p>
        </div>
        <span className="room-rule">
          15 × 15 <span>·</span> 자유룰
        </span>
      </div>
      <div className="room-layout">
        <section className="table-panel" aria-label="대국 테이블">
          <div className="table-status">
            <div className="status-copy" role="status" aria-live="polite">
              <i
                className={`mini-stone ${result?.kind === "win" ? result.winner : game.currentTurn}`}
              />
              <strong>{title}</strong>
            </div>
            <span>
              {String(game.moves.length).padStart(2, "0")} <small>수</small>
            </span>
          </div>
          {result && (
            <div className="result-banner">
              <span>
                {result.kind === "draw"
                  ? "빈자리가 없는 팽팽한 한 판이었네요."
                  : result.reason === "resignation"
                    ? "상대의 기권으로 대국이 종료되었어요."
                    : "다섯 개 이상의 돌을 연속으로 연결했어요."}
              </span>
              <button onClick={reset}>한 판 더 ↗</button>
            </div>
          )}
          <Board game={game} onPlace={place} />
          <div className="board-caption">
            <span>
              <i className="last-key" /> 마지막 수
            </span>
            <span id="board-help">방향키로 이동 · Enter / Space로 착수</span>
          </div>
          <p className="input-error" role="alert">
            {error}
          </p>
        </section>
        <aside className="room-sidebar">
          <section className="side-panel">
            <div className="section-label">
              PLAYERS <span>같은 화면에서 함께</span>
            </div>
            {(["black", "white"] as const).map((stone, i) => (
              <div
                className={`player ${!result && game.currentTurn === stone ? "active" : ""}`}
                key={stone}
              >
                <span className={`player-avatar ${stone}`}>
                  <i className={`mini-stone ${stone}`} />
                </span>
                <div>
                  <strong>플레이어 {i + 1}</strong>
                  <small>
                    {i === 0 ? "흑돌 · 먼저 두기" : "백돌 · 다음 두기"}
                  </small>
                </div>
                {!result && game.currentTurn === stone && (
                  <span className="turn-badge">차례</span>
                )}
                {result?.kind === "win" && result.winner === stone && (
                  <span className="turn-badge">승리</span>
                )}
              </div>
            ))}
          </section>
          <section className="side-panel history-panel">
            <div className="section-label">
              한 수의 기록 <span>{game.moves.length}수</span>
            </div>
            <div
              className="move-history"
              ref={history}
              tabIndex={0}
              aria-label="착수 기록"
            >
              {!game.moves.length ? (
                <div className="empty-history">
                  <span>＋</span>
                  <p>첫 수를 기다리고 있어요.</p>
                  <small>흑돌부터 원하는 자리에 놓아 주세요.</small>
                </div>
              ) : (
                <ol>
                  {game.moves.map((move, i) => (
                    <li key={i}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <i className={`mini-stone ${move.stone}`} />
                      <strong>{coordinate(move.x, move.y)}</strong>
                      {i === game.moves.length - 1 && <small>마지막 수</small>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
          <section className="side-panel rules-panel">
            <div className="section-label">
              이 테이블의 규칙 <span>↗</span>
            </div>
            <p>
              가로, 세로, 대각선으로 <strong>5개 이상</strong> 연결하면
              승리해요.
            </p>
            <p>
              금수와 무르기 없이 자유롭게 두세요. 판이 가득 차고 승자가 없으면
              무승부예요.
            </p>
          </section>
          <div className="room-actions">
            <button
              className="button secondary"
              onClick={() =>
                game.moves.length && !result ? setConfirm("reset") : reset()
              }
            >
              ↻ 새 게임
            </button>
            <button
              className="button quiet"
              disabled={Boolean(result)}
              onClick={() => setConfirm("resign")}
            >
              기권하기
            </button>
          </div>
          <p className="local-note">
            이 대국은 현재 탭에서만 유지돼요.
            <br />
            새로고침하면 처음부터 시작해요.
          </p>
        </aside>
      </div>
      {confirm && (
        <ConfirmDialog
          title={
            confirm === "reset"
              ? "새 판을 시작할까요?"
              : `${current}돌이 기권할까요?`
          }
          description={
            confirm === "reset"
              ? "진행 중인 대국과 착수 기록을 지우고 흑돌부터 다시 시작해요."
              : "상대 플레이어의 승리로 이번 대국이 끝나요."
          }
          confirmLabel={confirm === "reset" ? "새 게임 시작" : "기권하기"}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === "reset") reset();
            else resign();
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}
