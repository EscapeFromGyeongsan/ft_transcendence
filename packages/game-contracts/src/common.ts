// 현재 지원하는 게임. 게임을 추가할 때 공개 유니언도 함께 확장한다.
export type GameType = "gomoku" | "othello";

// 서버의 BIGINT identity를 JSON number로 전달한다.
// 입력 경계에서 1..Number.MAX_SAFE_INTEGER의 정수인지 검증한다.
export type PlayerId = number;

export type GameStatus = "waiting" | "playing" | "paused" | "finished";

// 행동의 종류와 데이터는 각 게임에서 정의한다.
export interface GameCommandBase {
  matchId: number;
  commandId: string;
  expectedVersion: number;
}

// 게임에 공통인 경기 식별 정보와 생명주기만 포함한다.
export interface GameSnapshotBase {
  matchId: number;
  rulesVersion: string;
  stateVersion: number;
  status: GameStatus;
}

export type GameError = {
  code:
    | "NOT_FOUND"
    | "NOT_PARTICIPANT"
    | "COMMAND_ID_CONFLICT"
    | "GAME_FINISHED"
    | "GAME_NOT_ACTIVE"
    | "VERSION_CONFLICT"
    | "NOT_YOUR_TURN"
    | "INVALID_ACTION";
  message: string;
};
