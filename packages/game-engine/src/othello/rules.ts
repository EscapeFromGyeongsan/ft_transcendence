import type { Cell } from "@cafe/game-contracts";
import { applyMove } from "./apply-move.ts";
import { createInitialState } from "./initial-state.ts";
import type {
  OthelloRuleDecision,
  OthelloRulesInput,
  OthelloState,
} from "./types.ts";

/**
 * 오델로 엔진 규칙 버전 식별자 (`IF-04`).
 *
 * 서버의 게임 명령 서비스(`createGameCommandService`)에 등록되어 경기 생성 시 대국 메타데이터에 기록됩니다.
 */
export const OTHELLO_RULES_VERSION = "othello-standard-v1";

/**
 * DB에 저장된 착수 이력을 순서대로 재생하여 현재 시점의 오델로 게임 상태를 복원합니다.
 *
 * 초기 상태에서 시작하여 각 착수를 `applyMove`로 순차 적용하며, 무결성을 검증합니다.
 *
 * @param moves - DB의 `game_moves` 테이블에 저장된 착수 이력 배열
 * @returns 복원된 현재 시점의 오델로 게임 상태 객체
 * @throws Error 착수 이력 데이터에 유효하지 않은 돌 색상이 있거나 불법 착수가 포함된 경우 (DB 손상)
 *
 * @remarks
 * ## 자동 패스 고려 (`move.stone` 직접 신뢰)
 * - 오델로는 상대방에게 둘 곳이 없을 때 자동 패스(동일 플레이어의 연속 착수)가 발생합니다.
 * - 따라서 단순한 흑/백 1:1 교대 착수를 가정하지 않고, DB에 기록된 `move.stone` 색상을 그대로
 *   착수 주체로 사용하여 상태를 결정론적(Deterministic)으로 재생합니다.
 *
 * ## 에러 처리 철학
 * - 현재 클라이언트의 요청이 잘못된 경우(`INVALID_ACTION`)와 DB에 저장된 과거 이력이 깨진 경우는
 *   완전히 다른 장애 범주입니다. 이력 손상은 서버 무결성 결함이므로 즉시 Error 예외를 던져 트랜잭션을 롤백시킵니다.
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
 * 서버의 초기 스냅샷 생성(`RegisteredRules.board`) 인터페이스에 바인딩됩니다.
 *
 * @param moves - DB에 저장된 착수 이력 배열
 * @returns 8×8 크기의 오델로 보드 셀 2차원 배열 (`Cell[][]`)
 * @throws Error 착수 이력이 손상되어 상태 복원에 실패한 경우
 *
 * @remarks
 * ## 서버 연동 (`IF-04`)
 * - 클라이언트가 WebSocket으로 대국에 접속하거나 새로고침할 때, 서버는 DB의 `game_moves`를 읽어
 *   이 함수를 호출함으로써 현재 판의 완전한 돌 배치 스냅샷(`match.snapshot`)을 구성합니다.
 */
export function board(moves: OthelloRulesInput["moves"]): Cell[][] {
  return restoreState(moves).board;
}

/**
 * 서버 `GameCommandService`에 등록되어 클라이언트의 착수를 검증하고 다음 차례나 게임 종료를 판정합니다.
 *
 * DB의 착수 이력으로 현재 상태를 복원한 뒤, 이번 착수 요청을 적용하여 유효성을 판정합니다.
 *
 * @param input - 착수 이력(`moves`), 착수자의 좌석 색상(`seat`), 착수 액션(`action`)
 * @returns 착수 승인 및 다음 차례/종료 정보(`{ ok: true, nextTurn, finish? }`), 또는 거절 코드(`{ ok: false, code }`)
 *
 * @remarks
 * ## 서버 등록 규격 예시
 * ```ts
 * createGameCommandService(db, {
 *   othello: {
 *     version: OTHELLO_RULES_VERSION,
 *     rules,
 *     board,
 *   },
 * });
 * ```
 *
 * ## 반환값 분기
 * - 규칙 위반 시: `{ ok: false, code: "INVALID_ACTION" | "GAME_FINISHED" }` 반환.
 * - 정상 종료 시: `{ ok: true, nextTurn: null, finish: { outcome, winner?, reason } }` 반환.
 * - 게임 계속 진행 시: `{ ok: true, nextTurn: "black" | "white" }` 반환 (자동 패스 시 동일 색상 반환).
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
