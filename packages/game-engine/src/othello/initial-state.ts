import type { Cell } from "@cafe/game-contracts";
import type { OthelloState } from "./types.ts";

/**
 * 표준 오델로 보드의 가로/세로 칸 수 (8×8).
 */
export const OTHELLO_BOARD_SIZE = 8;

/**
 * 8×8 오델로 표준 초기 게임 상태를 생성합니다.
 *
 * 중앙 4개 칸에 백돌과 흑돌이 교차 배치되며, 흑(`black`)이 선공합니다.
 *
 * @returns 8×8 초기 배치와 흑 선공 차례로 설정된 오델로 상태 객체
 *
 * @remarks
 * ## 초기 배치 좌표 규격 (0-based)
 * - `(3, 3)` = 백돌 (`"white"`)
 * - `(3, 4)` = 흑돌 (`"black"`)
 * - `(4, 3)` = 흑돌 (`"black"`)
 * - `(4, 4)` = 백돌 (`"white"`)
 *
 * ## 상태 불변성
 * - 매 호출마다 새로운 2차원 배열과 상태 객체를 생성하여 반환하므로,
 *   이전 상태나 다른 게임 인스턴스와 메모리를 공유하지 않습니다.
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
