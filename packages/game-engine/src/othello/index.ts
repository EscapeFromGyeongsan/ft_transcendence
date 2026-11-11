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
