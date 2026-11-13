/**
 * @fileoverview 8×8 표준 오델로(`othello`) 게임 엔진 모듈.
 *
 * 이 모듈은 8×8 보드 기반 표준 오델로 규칙을 구현합니다.
 * 중앙 4칸 초기 배치, 8방향 끼우기 및 뒤집기, 상대방 착수 불가 시 자동 패스(동일 차례 유지),
 * 양쪽 모두 둘 곳이 없을 때의 돌 수 비교 종료 판정을 제공합니다.
 *
 * ## 주요 구성 요소
 * - {@link createInitialState}, {@link OTHELLO_BOARD_SIZE}: 초기 상태 생성 및 보드 크기 상수
 * - {@link applyMove}, {@link hasLegalMoves}: 착수 적용 및 합법 수 탐색
 * - {@link board}, {@link rules}, {@link restoreState}: 서버 `IF-04` 계약 연동 및 상태 복원 함수
 * - {@link OTHELLO_RULES_VERSION}: 규칙 버전 식별자 (`"othello-standard-v1"`)
 */

export { createInitialState, OTHELLO_BOARD_SIZE } from "./initial-state.ts";
export { applyMove, hasLegalMoves } from "./apply-move.ts";
export { board, rules, restoreState, OTHELLO_RULES_VERSION } from "./rules.ts";
export type {
  OthelloState,
  OthelloMoveResult,
  OthelloFinish,
  OthelloRulesInput,
  OthelloRuleDecision,
} from "./types.ts";
