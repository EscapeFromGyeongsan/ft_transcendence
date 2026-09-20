import { useRef, useState, type KeyboardEvent } from "react";
import { BOARD_SIZE, type OmokState } from "@cafe/omok";

export const coordinate = (x: number, y: number) =>
  `${String.fromCharCode(65 + x)}${y + 1}`;
const indices = Array.from({ length: BOARD_SIZE }, (_, i) => i);
export function Board({
  game,
  onPlace,
}: {
  game: OmokState;
  onPlace: (x: number, y: number) => void;
}) {
  const [focused, setFocused] = useState(112);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const last = game.moves.at(-1);
  const winners = new Set(
    game.result?.kind === "win"
      ? game.result.line.map((p) => p.y * 15 + p.x)
      : [],
  );
  function navigate(event: KeyboardEvent, index: number) {
    let next = index;
    const x = index % 15,
      y = Math.floor(index / 15);
    if (event.key === "ArrowLeft") next = y * 15 + Math.max(0, x - 1);
    else if (event.key === "ArrowRight") next = y * 15 + Math.min(14, x + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, y - 1) * 15 + x;
    else if (event.key === "ArrowDown") next = Math.min(14, y + 1) * 15 + x;
    else if (event.key === "Home") next = event.ctrlKey ? 0 : y * 15;
    else if (event.key === "End") next = event.ctrlKey ? 224 : y * 15 + 14;
    else return;
    event.preventDefault();
    setFocused(next);
    refs.current[next]?.focus();
  }
  return (
    <div className="board-frame">
      <div className="column-labels" aria-hidden="true">
        {indices.map((i) => (
          <span key={i}>{String.fromCharCode(65 + i)}</span>
        ))}
      </div>
      <div className="row-labels" aria-hidden="true">
        {indices.map((i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <div
        className={`board turn-${game.currentTurn}`}
        role="group"
        aria-label="15 곱하기 15 오목판"
        aria-describedby="board-help"
      >
        <svg className="board-lines" viewBox="0 0 450 450" aria-hidden="true">
          {indices.map((i) => (
            <g key={i}>
              <path d={`M15 ${15 + 30 * i}H435 M${15 + 30 * i} 15V435`} />
            </g>
          ))}
          {[3, 7, 11].flatMap((y) =>
            [3, 7, 11]
              .filter((x) => (x === 7) === (y === 7))
              .map((x) => (
                <circle
                  key={`${x}-${y}`}
                  cx={15 + x * 30}
                  cy={15 + y * 30}
                  r="3"
                />
              )),
          )}
        </svg>
        {game.board.flatMap((row, y) =>
          row.map((stone, x) => {
            const index = y * 15 + x;
            const isLast = last?.x === x && last?.y === y;
            return (
              <button
                key={index}
                ref={(node) => {
                  refs.current[index] = node;
                }}
                className={`intersection ${stone ?? "empty"} ${isLast ? "last" : ""} ${winners.has(index) ? "winning" : ""}`}
                tabIndex={focused === index ? 0 : -1}
                onFocus={() => setFocused(index)}
                aria-label={`${coordinate(x, y)}, ${stone === "black" ? "흑돌" : stone === "white" ? "백돌" : "빈 자리"}${isLast ? ", 마지막 수" : ""}`}
                aria-disabled={Boolean(stone || game.result)}
                onKeyDown={(event) => navigate(event, index)}
                onClick={() => onPlace(x, y)}
              >
                {stone && <span className="stone" />}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
