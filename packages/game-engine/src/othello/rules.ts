import type { Cell } from "@cafe/game-contracts";
import { applyMove } from "./apply-move.ts";
import { createInitialState } from "./initial-state.ts";
import type {
  OthelloRuleDecision,
  OthelloRulesInput,
  OthelloState,
} from "./types.ts";

export const OTHELLO_RULES_VERSION = "othello-standard-v1";

/**
 * DB의 착수 이력을 순서대로 재생하여 현재 오델로 상태를 복원합니다.
 *
 * 오델로는 자동 패스가 발생할 수 있으므로, 단순 흑백 교대 착수를 가정하지 않고
 * 저장된 move.stone 색상을 그대로 사용하여 상태를 검증 및 재생합니다.
 *
 * @param moves - DB에 저장된 착수 이력 배열
 * @returns 복원된 오델로 상태
 * @throws Error 이력이 유효하지 않거나 손상된 경우
 */
export function restoreState(moves: OthelloRulesInput["moves"]): OthelloState {
  let state = createInitialState();
  for (const [index, move] of moves.entries()) {
    if (move.stone !== "black" && move.stone !== "white") {
      throw new Error(`Invalid othello history at move ${index + 1}: stone`);
    }
    const result = applyMove(
      state,
      { type: "place", row: move.row, col: move.col },
      move.stone,
    );
    if (!result.ok) {
      throw new Error(
        `Invalid othello history at move ${index + 1}: ${result.error.code}`,
      );
    }
    state = result.state;
  }
  return state;
}

/**
 * 저장된 착수 이력을 재생하여 현재 오델로 판의 8×8 상태를 반환합니다.
 *
 * 서버의 snapshot 생성(`RegisteredRules.board`)에서 호출됩니다.
 *
 * @param moves - DB에 저장된 착수 이력 배열
 * @returns 8×8 크기의 오델로 보드 셀 2차원 배열
 */
export function board(moves: OthelloRulesInput["moves"]): Cell[][] {
  return restoreState(moves).board;
}

/**
 * 서버 GameCommandService에 등록되어 착수를 검증하고 다음 차례나 종료를 판정합니다.
 *
 * 서버 등록 형식:
 * createGameCommandService(db, { othello: { version, rules, board } })
 *
 * @param input - 착수 이력, 착수자 자리(색), 착수 액션
 * @returns 착수 승인 및 다음 상태 전이 정보, 또는 거절 코드
 */
export function rules(input: OthelloRulesInput): OthelloRuleDecision {
  const result = applyMove(restoreState(input.moves), input.action, input.seat);
  if (!result.ok) {
    return { ok: false, code: result.error.code };
  }
  if (result.state.result) {
    return { ok: true, nextTurn: null, finish: result.state.result };
  }
  return { ok: true, nextTurn: result.state.currentPlayerColor };
}
