import { useId } from "react";
import type { OmokState } from "@cafe/omok";
import type { VersionedGameState } from "@cafe/game-contracts";
import { Board, coordinate } from "./Board";
import type { OnlineGameProps } from "../types";

function isOmokState(game: VersionedGameState): game is OmokState {
  return (
    "gameType" in game &&
    game.gameType === "omok" &&
    "board" in game &&
    Array.isArray(game.board) &&
    "moves" in game &&
    Array.isArray(game.moves)
  );
}
export function OnlineOmokGame({
  room,
  self,
  pending,
  connected,
  onAction,
  onError,
}: OnlineGameProps) {
  const helpId = useId();
  if (!isOmokState(room.game))
    return <p role="alert">오목 상태를 표시할 수 없어요.</p>;
  const game = room.game;
  const myTurn = Boolean(
    self &&
    room.status === "playing" &&
    game.currentTurn === (self.seat === 0 ? "black" : "white"),
  );
  function move(x: number, y: number) {
    if (pending || !connected) return;
    if (!myTurn) {
      onError("상대의 차례예요.");
      return;
    }
    onAction({ type: "PLACE_STONE", x, y });
  }
  return (
    <div className="room-layout">
      <section className="table-panel" aria-label="온라인 대국 테이블">
        <div className="table-status">
          <div className="status-copy" role="status" aria-live="polite">
            <strong>
              {game.result
                ? game.result.kind === "draw"
                  ? "무승부"
                  : `${game.result.winner === "black" ? "흑" : "백"}돌 승리!`
                : `${game.currentTurn === "black" ? "흑" : "백"}돌 차례${myTurn ? " · 내 차례" : ""}`}
            </strong>
          </div>
          <span>{game.moves.length}수</span>
        </div>
        <Board game={game} onPlace={move} helpId={helpId} />
        <p id={helpId} className="board-caption">
          {self
            ? myTurn
              ? "원하는 교차점을 선택하세요."
              : "상대의 수를 기다려 주세요."
            : "관전 중입니다."}
        </p>
      </section>
      <aside className="room-sidebar">
        <section className="side-panel">
          <div className="section-label">PLAYERS</div>
          {room.players.map((player) => (
            <div className="player" key={player.id}>
              <span
                className={`player-avatar ${player.seat === 0 ? "black" : "white"}`}
              >
                <i
                  className={`mini-stone ${player.seat === 0 ? "black" : "white"}`}
                />
              </span>
              <strong>
                {player.name}
                {player.id === self?.id ? " (나)" : ""}
              </strong>
            </div>
          ))}
        </section>
        <section className="side-panel history-panel">
          <div className="section-label">
            착수 기록 <span>{game.moves.length}수</span>
          </div>
          <ol className="move-history">
            {game.moves.map((move, index) => (
              <li key={index}>
                {index + 1}. {move.stone === "black" ? "흑" : "백"}{" "}
                {coordinate(move.x, move.y)}
              </li>
            ))}
          </ol>
        </section>
        {room.status === "playing" && self && (
          <button
            className="button quiet"
            disabled={pending || !connected}
            onClick={() => {
              if (!myTurn) {
                onError("자신의 차례에 기권할 수 있어요.");
                return;
              }
              if (window.confirm("정말 기권할까요?"))
                onAction({ type: "RESIGN" });
            }}
          >
            기권하기
          </button>
        )}
      </aside>
    </div>
  );
}
