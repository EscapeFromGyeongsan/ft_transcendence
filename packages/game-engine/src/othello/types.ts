import type {
  Cell,
  GameError,
  PlaceAction,
  PlayerColor,
} from "@cafe/game-contracts";

/**
 * 오델로 게임 정상 종료 결과.
 *
 * 승자는 색으로 표현하며, 사용자 ID 매핑은 서버의 경기 관리 계층에서 담당합니다.
 */
export type OthelloFinish =
  | { outcome: "win"; winner: PlayerColor; reason: "disc_count" }
  | { outcome: "draw"; reason: "draw" };

/**
 * 오델로 게임의 엔진 내부 상태.
 */
export type OthelloState = { board: Cell[][] } & (
  | { currentPlayerColor: PlayerColor; result: null }
  | { currentPlayerColor: null; result: OthelloFinish }
);

/**
 * 착수 적용 결과.
 */
export type OthelloMoveResult =
  | { ok: true; state: OthelloState }
  | {
      ok: false;
      error: GameError & { code: "INVALID_ACTION" | "GAME_FINISHED" };
    };

/**
 * 서버 GameRules 입력과 호환되는 오델로 규칙 입력 인터페이스.
 */
export interface OthelloRulesInput {
  moves: readonly { row: number; col: number; stone: string }[];
  seat: PlayerColor;
  action: PlaceAction;
}

/**
 * 서버 GameRules 반환값과 호환되는 오델로 규칙 판정 결과.
 */
export type OthelloRuleDecision =
  | { ok: false; code: "INVALID_ACTION" | "GAME_FINISHED" }
  | { ok: true; nextTurn: PlayerColor | null; finish?: OthelloFinish };
