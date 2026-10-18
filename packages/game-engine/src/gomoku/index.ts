export { createInitialState, GOMOKU_BOARD_SIZE } from "./initial-state.ts";
export { applyMove } from "./apply-move.ts";
export { rules, restoreState, GOMOKU_RULES_VERSION } from "./rules.ts";
export type {
  GomokuState,
  GomokuMoveResult,
  GomokuFinish,
  GomokuRulesInput,
  GomokuRuleDecision,
} from "./types.ts";
