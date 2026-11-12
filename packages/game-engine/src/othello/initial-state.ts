import type { Cell } from "@cafe/game-contracts";
import type { OthelloState } from "./types.ts";

export const OTHELLO_BOARD_SIZE = 8;

/**
 * 8×8 오델로 표준 초기 상태를 생성합니다.
 *
 * 중앙 4개 칸에 (3,3) 백, (3,4) 흑, (4,3) 흑, (4,4) 백이 배치되며 흑이 선공합니다.
 *
 * @returns 8×8 초기 배치와 흑 차례로 설정된 오델로 상태
 */
export function createInitialState(): OthelloState {
  const board: Cell[][] = Array.from({ length: OTHELLO_BOARD_SIZE }, () =>
    Array.from({ length: OTHELLO_BOARD_SIZE }, () => null),
  );

  // 중앙 4개 기본 배치: (3,3) 백, (4,4) 백, (3,4) 흑, (4,3) 흑
  board[3][3] = "white";
  board[3][4] = "black";
  board[4][3] = "black";
  board[4][4] = "white";

  return {
    board,
    currentPlayerColor: "black",
    result: null,
  };
}
