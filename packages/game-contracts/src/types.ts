// JSON에 저장될 타입 정의!

export type GameType = "gomoku" | "othello";
export type PlayerId = string;
export type Cell = "black" | "white" | null;

// matchID: 어느 경기인지 나타내는 ID
// commandID: 어느 요청인지 나타내는 ID, 재전송 시 같은 ID 사용함.
// expectedVersion: 클라이언트가 보고 있던 상태 버전
// stateVersion: 서버가 확정한 현재 상태 버전
// rulesVersion: 이 경기에서 사용하는 규칙 버전

// 클라이언트가 서버에 보내는 행동 요청
export type GameCommand = {
  gameType: GameType;
  matchId: string;
  commandId: string;
  expectedVersion: number;
  // 좌표는 0부터 시작하는 row/col. 오목 0..14, 오델로 0..7.
  // 정수·범위·합법 착수 여부는 서버에서 별도로 검증한다.
  action: {
    type: "place";
    row: number;
    col: number;
  };
};

// 경기 종료 결과
export type GameResult =
  | {
      outcome: "win";
      winnerId: PlayerId;
      reason: "five_in_row" | "disc_count" | "resign" | "disconnect_timeout";
    }
  | {
      outcome: "draw";
      winnerId: null;
      reason: "draw";
    }
  | {
      outcome: "void";
      winnerId: null;
      reason: "server_restart" | "disconnect_timeout";
    };

// 서버가 참가자에게 보내는 현재 경기 상태
export type GameSnapshot = {
  gameType: GameType;
  matchId: string;
  rulesVersion: string;
  stateVersion: number;
  status: "waiting" | "playing" | "paused" | "finished";
  players: {
    black: PlayerId;
    white: PlayerId;
  };
  board: Cell[][];
  currentPlayerId: PlayerId | null;
  result: GameResult | null;
};

// 발생 에러
export type GameError = {
  code:
    "INVALID_ACTION" | "VERSION_CONFLICT" | "NOT_PARTICIPANT" | "GAME_FINISHED";
  message: string;
};
