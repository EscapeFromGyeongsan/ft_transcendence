import type {
  Cell,
  GameError,
  PlaceAction,
  PlayerColor,
} from "@cafe/game-contracts";

// 승자는 색으로 표현한다. 사용자 ID와 전송 결과는 경기 관리 계층에서 연결한다.
export type GomokuFinish =
  | { outcome: "win"; winner: PlayerColor; reason: "five_in_row" }
  | { outcome: "draw"; reason: "draw" };

export type GomokuState = { board: Cell[][] } & (
  | { currentPlayerColor: PlayerColor; result: null }
  | { currentPlayerColor: null; result: GomokuFinish }
);

export type GomokuMoveResult =
  | { ok: true; state: GomokuState }
  | {
      ok: false;
      error: GameError & { code: "INVALID_ACTION" | "GAME_FINISHED" };
    };

// PR #11의 GameRules 입력/출력과 구조적으로 호환되는 엔진 연결 지점.
export interface GomokuRulesInput {
  moves: readonly { row: number; col: number; stone: string }[];
  seat: PlayerColor;
  action: PlaceAction;
}

export type GomokuRuleDecision =
  | { ok: false; code: "INVALID_ACTION" | "GAME_FINISHED" }
  | { ok: true; nextTurn: PlayerColor | null; finish?: GomokuFinish };
