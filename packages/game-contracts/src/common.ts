// 현재 지원하는 게임. 게임을 추가할 때 공개 유니언도 함께 확장한다.
export type GameType = "gomoku" | "othello";

export type PlayerId = string;

export type GameStatus = "waiting" | "playing" | "paused" | "finished";

// 행동의 종류와 데이터는 각 게임에서 정의한다.
export interface GameCommandBase {
  matchId: string;
  commandId: string;
  expectedVersion: number;
}

// 게임에 공통인 경기 식별 정보와 생명주기만 포함한다.
export interface GameSnapshotBase {
  matchId: string;
  rulesVersion: string;
  stateVersion: number;
  status: GameStatus;
}

export type GameError = {
  code:
    "INVALID_ACTION" | "VERSION_CONFLICT" | "NOT_PARTICIPANT" | "GAME_FINISHED";
  message: string;
};
