import type { Cell } from "@cafe/game-contracts";
import { applyMove } from "./apply-move.ts";
import { createInitialState } from "./initial-state.ts";
import type {
  GomokuRuleDecision,
  GomokuRulesInput,
  GomokuState,
} from "./types.ts";

export const GOMOKU_RULES_VERSION = "gomoku-freestyle-v1";

// DB의 착수 순서 그대로 재생한다. 손상된 이력은 현재 명령의 불법 착수와 구분한다.
export function restoreState(moves: GomokuRulesInput["moves"]): GomokuState {
  let state = createInitialState();
  for (const [index, move] of moves.entries()) {
    if (move.stone !== "black" && move.stone !== "white") {
      throw new Error(`Invalid gomoku history at move ${index + 1}: stone`);
    }
    const result = applyMove(
      state,
      { type: "place", row: move.row, col: move.col },
      move.stone,
    );
    if (!result.ok) {
      throw new Error(
        `Invalid gomoku history at move ${index + 1}: ${result.error.code}`,
      );
    }
    state = result.state;
  }
  return state;
}

// 서버 snapshot의 판. 저장된 이력을 재생하므로 손상된 이력이면
// restoreState와 같은 예외를 던진다.
export function board(moves: GomokuRulesInput["moves"]): Cell[][] {
  return restoreState(moves).board;
}

// 서버에는 board와 함께 등록한다:
// createGameCommandService(db, { gomoku: { version, rules, board } })
export function rules(input: GomokuRulesInput): GomokuRuleDecision {
  const result = applyMove(restoreState(input.moves), input.action, input.seat);
  if (!result.ok) return { ok: false, code: result.error.code };
  if (result.state.result) {
    return { ok: true, nextTurn: null, finish: result.state.result };
  }
  return { ok: true, nextTurn: result.state.currentPlayerColor };
}
