import type { Cell, PlayerColor } from "@cafe/game-contracts";
import { OTHELLO_BOARD_SIZE } from "./initial-state.ts";
import type {
  OthelloFinish,
  OthelloMoveResult,
  OthelloState,
} from "./types.ts";

const DIRECTIONS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

/**
 * 특정 칸에 돌을 놓았을 때 뒤집을 수 있는 상대 돌의 좌표 목록을 반환합니다.
 */
function findFlippableDiscs(
  board: Cell[][],
  row: number,
  col: number,
  color: PlayerColor,
): { r: number; c: number }[] {
  const opponentColor: PlayerColor = color === "black" ? "white" : "black";
  const discsToFlip: { r: number; c: number }[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    let r = row + dr;
    let c = col + dc;
    const directionDiscs: { r: number; c: number }[] = [];

    // 상대 돌이 연속으로 있는지 추적
    while (
      r >= 0 &&
      r < OTHELLO_BOARD_SIZE &&
      c >= 0 &&
      c < OTHELLO_BOARD_SIZE &&
      board[r][c] === opponentColor
    ) {
      directionDiscs.push({ r, c });
      r += dr;
      c += dc;
    }

    // 끝에 자신의 돌이 있어 끼우기에 성공한 경우만 뒤집기 목록에 추가
    if (
      directionDiscs.length > 0 &&
      r >= 0 &&
      r < OTHELLO_BOARD_SIZE &&
      c >= 0 &&
      c < OTHELLO_BOARD_SIZE &&
      board[r][c] === color
    ) {
      discsToFlip.push(...directionDiscs);
    }
  }

  return discsToFlip;
}

/**
 * 특정 색상의 플레이어에게 합법적인 착수 위치가 하나라도 있는지 검사합니다.
 */
export function hasLegalMoves(board: Cell[][], color: PlayerColor): boolean {
  for (let r = 0; r < OTHELLO_BOARD_SIZE; r++) {
    for (let c = 0; c < OTHELLO_BOARD_SIZE; c++) {
      if (board[r][c] === null) {
        if (findFlippableDiscs(board, r, c, color).length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * 판 위의 돌 개수를 세어 게임 종료 결과를 계산합니다.
 */
function evaluateFinish(board: Cell[][]): OthelloFinish {
  let blackCount = 0;
  let whiteCount = 0;

  for (let r = 0; r < OTHELLO_BOARD_SIZE; r++) {
    for (let c = 0; c < OTHELLO_BOARD_SIZE; c++) {
      if (board[r][c] === "black") blackCount++;
      else if (board[r][c] === "white") whiteCount++;
    }
  }

  if (blackCount > whiteCount) {
    return { outcome: "win", winner: "black", reason: "disc_count" };
  }
  if (whiteCount > blackCount) {
    return { outcome: "win", winner: "white", reason: "disc_count" };
  }
  return { outcome: "draw", reason: "draw" };
}

/**
 * 오델로 상태에 착수를 검증하고 적용합니다.
 *
 * 8방향 끼우기 및 뒤집기를 처리하고, 상대에게 합법 수가 없으면 자동 패스(동일 차례 유지),
 * 양쪽 모두 둘 곳이 없으면 돌 수 비교로 게임을 종료합니다.
 *
 * @param state - 현재 오델로 게임 상태
 * @param action - 착수 좌표
 * @param actionColor - 착수하는 플레이어의 돌 색상
 * @returns 갱신된 게임 상태 또는 거절 오류
 */
export function applyMove(
  state: OthelloState,
  action: { type: string; row: number; col: number },
  actionColor: PlayerColor,
): OthelloMoveResult {
  if (state.result !== null || state.currentPlayerColor === null) {
    return {
      ok: false,
      error: { code: "GAME_FINISHED", message: "Game is already finished" },
    };
  }

  if (actionColor !== state.currentPlayerColor) {
    return {
      ok: false,
      error: { code: "INVALID_ACTION", message: "It is not your turn" },
    };
  }

  if (action.type !== "place") {
    return {
      ok: false,
      error: { code: "INVALID_ACTION", message: "Unsupported action" },
    };
  }

  if (!Number.isInteger(action.row) || !Number.isInteger(action.col)) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "Board coordinates must be integers",
      },
    };
  }

  if (
    action.row < 0 ||
    action.row >= OTHELLO_BOARD_SIZE ||
    action.col < 0 ||
    action.col >= OTHELLO_BOARD_SIZE
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "Board coordinates out of bounds",
      },
    };
  }

  if (state.board[action.row][action.col] !== null) {
    return {
      ok: false,
      error: { code: "INVALID_ACTION", message: "Cell is already occupied" },
    };
  }

  const flippable = findFlippableDiscs(
    state.board,
    action.row,
    action.col,
    actionColor,
  );
  if (flippable.length === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "Move does not capture any opponent pieces",
      },
    };
  }

  // 보드 복제 및 착수/뒤집기 적용
  const nextBoard: Cell[][] = state.board.map((row) => [...row]);
  nextBoard[action.row][action.col] = actionColor;
  for (const { r, c } of flippable) {
    nextBoard[r][c] = actionColor;
  }

  const opponentColor: PlayerColor =
    actionColor === "black" ? "white" : "black";

  // 차례 전이 및 패스/종료 판정
  if (hasLegalMoves(nextBoard, opponentColor)) {
    // 상대방이 둘 수 있으면 일반적인 차례 교대
    return {
      ok: true,
      state: {
        board: nextBoard,
        currentPlayerColor: opponentColor,
        result: null,
      },
    };
  }

  // 상대방이 둘 곳이 없음 -> 상대방 자동 패스
  if (hasLegalMoves(nextBoard, actionColor)) {
    // 현재 플레이어는 계속 둘 수 있으므로 차례 유지
    return {
      ok: true,
      state: {
        board: nextBoard,
        currentPlayerColor: actionColor,
        result: null,
      },
    };
  }

  // 양쪽 모두 둘 곳이 없음 (판이 가득 찼거나 둘 다 착수 불가) -> 종료
  return {
    ok: true,
    state: {
      board: nextBoard,
      currentPlayerColor: null,
      result: evaluateFinish(nextBoard),
    },
  };
}
