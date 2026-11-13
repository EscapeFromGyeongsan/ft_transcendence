/**
 * @fileoverview 15×15 자유룰 오목(`gomoku`) 게임 엔진 모듈.
 *
 * 이 모듈은 15×15 보드 기반 자유룰 오목 규칙을 구현합니다.
 * 흑 선공, 4축 양방향 O(1) 5목 판정, 6목 이상 장목 승리 인정(자유룰),
 * 마지막 225번째 착수 시의 승리 우선순위, 판 가득 참 시 무승부 판정을 제공합니다.
 *
 * ## 주요 구성 요소
 * - {@link createInitialState}, {@link GOMOKU_BOARD_SIZE}: 초기 상태 생성 및 보드 크기 상수
 * - {@link applyMove}: 착수 유효성 검증 및 상태 전이 함수
 * - {@link board}, {@link rules}, {@link restoreState}: 서버 `IF-04` 계약 연동 및 상태 복원 함수
 * - {@link GOMOKU_RULES_VERSION}: 규칙 버전 식별자 (`"gomoku-freestyle-v1"`)
 */

export { createInitialState, GOMOKU_BOARD_SIZE } from "./initial-state.ts";
export { applyMove } from "./apply-move.ts";
export { board, rules, restoreState, GOMOKU_RULES_VERSION } from "./rules.ts";
export type {
  GomokuState,
  GomokuMoveResult,
  GomokuFinish,
  GomokuRulesInput,
  GomokuRuleDecision,
} from "./types.ts";
