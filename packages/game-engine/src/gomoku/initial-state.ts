import type { Cell } from "@cafe/game-contracts";
import type { GomokuState } from "./types.ts";

/**
 * 표준 오목 보드의 가로/세로 줄 수 (15×15, 총 225칸).
 */
export const GOMOKU_BOARD_SIZE = 15;

/**
 * 15×15 오목 초기 게임 상태를 생성합니다.
 *
 * 225칸 전체가 빈 칸(`null`)인 보드가 생성되며, 흑(`black`)이 선공합니다.
 *
 * @returns 15×15 빈 보드와 흑 선공 차례로 설정된 오목 상태 객체
 *
 * @remarks
 * ## 초기 상태 규격
 * - 보드 크기: 15×15 (`row: 0..14`, `col: 0..14`)
 * - 모든 셀: `null` (빈 칸)
 * - 첫 턴 플레이어: `"black"` (흑돌 선공)
 * - 게임 결과: `null` (진행 중)
 *
 * ## 상태 불변성
 * - 매 호출마다 독립적인 2차원 배열과 새로운 상태 객체를 반환하므로 인스턴스 간 상태 오염이 없습니다.
 */
export function createInitialState(): GomokuState {
  return {
    board: Array.from({ length: GOMOKU_BOARD_SIZE }, () =>
      Array<Cell>(GOMOKU_BOARD_SIZE).fill(null),
    ),
    currentPlayerColor: "black",
    result: null,
  };
}
