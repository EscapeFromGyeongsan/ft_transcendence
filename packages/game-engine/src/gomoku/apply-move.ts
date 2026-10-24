import type { PlaceAction, PlayerColor } from "@cafe/game-contracts";
import { GOMOKU_BOARD_SIZE } from "./initial-state.ts";
import type { GomokuFinish, GomokuMoveResult, GomokuState } from "./types.ts";

function hasFive(
  board: GomokuState["board"],
  row: number,
  col: number,
  color: PlayerColor,
): boolean {
  return [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ].some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + sign * dr;
      let c = col + sign * dc;
      while (
        r >= 0 &&
        r < GOMOKU_BOARD_SIZE &&
        c >= 0 &&
        c < GOMOKU_BOARD_SIZE &&
        board[r][c] === color
      ) {
        count++;
        r += sign * dr;
        c += sign * dc;
      }
    }
    return count >= 5;
  });
}

export function applyMove(
  state: GomokuState,
  action: PlaceAction,
  playerColor: PlayerColor,
): GomokuMoveResult {
  if (state.result !== null) {
    return {
      ok: false,
      error: { code: "GAME_FINISHED", message: "이미 종료된 경기입니다." },
    };
  }

  const { row, col } = action;

  if (
    action.type !== "place" ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= GOMOKU_BOARD_SIZE ||
    col < 0 ||
    col >= GOMOKU_BOARD_SIZE
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "착수 좌표는 0부터 14까지의 정수여야 합니다.",
      },
    };
  }

  if (playerColor !== state.currentPlayerColor) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "현재 차례인 플레이어만 착수할 수 있습니다.",
      },
    };
  }

  if (state.board[row][col] !== null) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "이미 돌이 있는 칸에는 착수할 수 없습니다.",
      },
    };
  }

  // 모든 행을 복사해서 기존 상태와 결과 상태의 보드가 독립되도록 한다.
  const board = state.board.map((boardRow) => [...boardRow]);
  board[row][col] = playerColor;

  // 마지막 빈칸에 놓아 이기는 경우에도 승리 판정을 먼저 한다.
  const result: GomokuFinish | null = hasFive(board, row, col, playerColor)
    ? { outcome: "win", winner: playerColor, reason: "five_in_row" }
    : board.every((line) => line.every((cell) => cell !== null))
      ? { outcome: "draw", reason: "draw" }
      : null;

  return {
    ok: true,
    state: result
      ? { board, currentPlayerColor: null, result }
      : {
          board,
          currentPlayerColor: playerColor === "black" ? "white" : "black",
          result: null,
        },
  };
}
