import type { PlayerId } from "../common.ts";

// 현재 두 게임의 1:1 결과 형식. 게임별 정상 승리 사유를 전달한다.
// 다른 승자·점수 형식이 필요한 게임은 자기 결과 타입을 정의할 수 있다.
export type TwoPlayerResult<WinReason extends string> =
  | {
      outcome: "win";
      winnerId: PlayerId;
      reason: WinReason | "resign" | "disconnect_timeout";
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
