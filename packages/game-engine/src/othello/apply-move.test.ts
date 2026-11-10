import type { Cell } from "@cafe/game-contracts";
import { describe, expect, it } from "vitest";
import { applyMove, hasLegalMoves } from "./apply-move.ts";
import { createInitialState } from "./initial-state.ts";
import type { OthelloState } from "./types.ts";

function createEmptyBoard(): Cell[][] {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null));
}

describe("othello applyMove", () => {
  describe("초기 상태 및 기본 착수", () => {
    it("초기 상태에서 흑의 합법 착수 4곳((2,3), (3,2), (4,5), (5,4))에 정상 착수되고 돌이 뒤집힌다", () => {
      // (2,3) 착수: (3,3) 백돌이 흑돌로 뒤집히고 백 차례로 전이
      const state1 = createInitialState();
      const res1 = applyMove(
        state1,
        { type: "place", row: 2, col: 3 },
        "black",
      );
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.state.board[2][3]).toBe("black");
        expect(res1.state.board[3][3]).toBe("black"); // 뒤집힘
        expect(res1.state.board[4][3]).toBe("black");
        expect(res1.state.currentPlayerColor).toBe("white");
        expect(res1.state.result).toBeNull();
      }

      // (3,2) 착수: (3,3) 백돌이 흑돌로 뒤집힘
      const state2 = createInitialState();
      const res2 = applyMove(
        state2,
        { type: "place", row: 3, col: 2 },
        "black",
      );
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.state.board[3][2]).toBe("black");
        expect(res2.state.board[3][3]).toBe("black");
        expect(res2.state.currentPlayerColor).toBe("white");
      }

      // (4,5) 착수: (4,4) 백돌이 흑돌로 뒤집힘
      const state3 = createInitialState();
      const res3 = applyMove(
        state3,
        { type: "place", row: 4, col: 5 },
        "black",
      );
      expect(res3.ok).toBe(true);
      if (res3.ok) {
        expect(res3.state.board[4][5]).toBe("black");
        expect(res3.state.board[4][4]).toBe("black");
        expect(res3.state.currentPlayerColor).toBe("white");
      }

      // (5,4) 착수: (4,4) 백돌이 흑돌로 뒤집힘
      const state4 = createInitialState();
      const res4 = applyMove(
        state4,
        { type: "place", row: 5, col: 4 },
        "black",
      );
      expect(res4.ok).toBe(true);
      if (res4.ok) {
        expect(res4.state.board[5][4]).toBe("black");
        expect(res4.state.board[4][4]).toBe("black");
        expect(res4.state.currentPlayerColor).toBe("white");
      }
    });

    it("백의 응수 착수가 정상 처리된다", () => {
      const state = createInitialState();
      const step1 = applyMove(
        state,
        { type: "place", row: 2, col: 3 },
        "black",
      );
      expect(step1.ok).toBe(true);
      if (!step1.ok) return;

      // 흑 (2,3) 착수 후 백은 (2,2), (2,4), (4,2) 등에 착수 가능
      // (2,4)에 백 착수 시 (3,4) 흑돌이 백돌로 뒤집힘
      const step2 = applyMove(
        step1.state,
        { type: "place", row: 2, col: 4 },
        "white",
      );
      expect(step2.ok).toBe(true);
      if (step2.ok) {
        expect(step2.state.board[2][4]).toBe("white");
        expect(step2.state.board[3][4]).toBe("white"); // 뒤집힘
        expect(step2.state.currentPlayerColor).toBe("black");
      }
    });
  });

  describe("불법 착수 검증 (INVALID_ACTION)", () => {
    it("차례가 아닌 플레이어가 착수하면 거절한다", () => {
      const state = createInitialState(); // 흑 차례
      const res = applyMove(state, { type: "place", row: 2, col: 3 }, "white");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("INVALID_ACTION");
        expect(res.error.message).toMatch(/not your turn/i);
      }
    });

    it("이미 돌이 놓인 칸에 착수하면 거절한다", () => {
      const state = createInitialState();
      const res = applyMove(state, { type: "place", row: 3, col: 3 }, "black");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("INVALID_ACTION");
        expect(res.error.message).toMatch(/occupied/i);
      }
    });

    it("상대 돌을 하나도 끼우지 못하는 빈 칸에 착수하면 거절한다", () => {
      const state = createInitialState();
      const res = applyMove(state, { type: "place", row: 0, col: 0 }, "black");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("INVALID_ACTION");
        expect(res.error.message).toMatch(/capture/i);
      }
    });

    it("보드 좌표 범위를 벗어나면 거절한다", () => {
      const state = createInitialState();
      const res1 = applyMove(
        state,
        { type: "place", row: -1, col: 3 },
        "black",
      );
      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.error.code).toBe("INVALID_ACTION");

      const res2 = applyMove(state, { type: "place", row: 3, col: 8 }, "black");
      expect(res2.ok).toBe(false);
      if (!res2.ok) expect(res2.error.code).toBe("INVALID_ACTION");
    });

    it("정수가 아닌 좌표는 거절한다", () => {
      const state = createInitialState();
      const res = applyMove(
        state,
        { type: "place", row: 2.5, col: 3 },
        "black",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("INVALID_ACTION");
    });

    it("지원되지 않는 액션 타입은 거절한다", () => {
      const state = createInitialState();
      const res = applyMove(
        state,
        { type: "pass" as any, row: 2, col: 3 },
        "black",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("INVALID_ACTION");
    });
  });

  describe("다방향 및 연속 뒤집기", () => {
    it("한 번의 착수로 여러 방향의 상대 돌을 동시에 뒤집는다", () => {
      const board = createEmptyBoard();
      // (3,3)에 흑이 놓았을 때 위쪽(가로), 왼쪽(세로), 대각선에서 동시 뒤집기 구성
      // (3,1)=흑, (3,2)=백, (3,3)=놓을자리
      // (1,3)=흑, (2,3)=백, (3,3)=놓을자리
      // (1,1)=흑, (2,2)=백, (3,3)=놓을자리
      board[3][1] = "black";
      board[3][2] = "white";
      board[1][3] = "black";
      board[2][3] = "white";
      board[1][1] = "black";
      board[2][2] = "white";
      // 백의 합법 착수 칸도 최소 하나 마련 (예: (5,5)=백, (5,6)=흑, (5,7)=빈칸)
      board[5][5] = "white";
      board[5][6] = "black";

      const state: OthelloState = {
        board,
        currentPlayerColor: "black",
        result: null,
      };

      const res = applyMove(state, { type: "place", row: 3, col: 3 }, "black");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.state.board[3][3]).toBe("black");
        expect(res.state.board[3][2]).toBe("black"); // 가로 뒤집힘
        expect(res.state.board[2][3]).toBe("black"); // 세로 뒤집힘
        expect(res.state.board[2][2]).toBe("black"); // 대각선 뒤집힘
      }
    });

    it("한 방향에 상대 돌이 여러 개 연속으로 있을 때 모두 뒤집힌다", () => {
      const board = createEmptyBoard();
      // 흑 (3,0), 백 (3,1), 백 (3,2), 백 (3,3), 흑이 (3,4)에 착수
      board[3][0] = "black";
      board[3][1] = "white";
      board[3][2] = "white";
      board[3][3] = "white";
      // 백 합법 수용 여유 돌
      board[6][6] = "white";
      board[6][5] = "black";

      const state: OthelloState = {
        board,
        currentPlayerColor: "black",
        result: null,
      };

      const res = applyMove(state, { type: "place", row: 3, col: 4 }, "black");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.state.board[3][1]).toBe("black");
        expect(res.state.board[3][2]).toBe("black");
        expect(res.state.board[3][3]).toBe("black");
        expect(res.state.board[3][4]).toBe("black");
      }
    });
  });

  describe("자동 패스 (Pass) 및 턴 유지", () => {
    it("상대방이 둘 곳이 없으면 별도 명령 없이 착수자의 차례가 유지된다", () => {
      // 패스 시나리오: 백돌은 남아 있지만 백이 둘 수 있는 합법 수가 없고 흑만 합법 수가 있는 보드
      const passBoard = createEmptyBoard();
      // 행 0: 흑(0,0), 백(0,1), 빈칸(0,2 착수 가능)
      passBoard[0][0] = "black";
      passBoard[0][1] = "white";
      // 행 2: 흑(2,0), 백(2,1), 빈칸(2,2 착수 가능)
      passBoard[2][0] = "black";
      passBoard[2][1] = "white";

      // 흑이 (0,2)에 두면 행0은 [B, B, B]가 됨.
      // 이제 백은 행2의 W(2,1)이 남아있지만, W(2,1)과 B(2,0)으로는 백이 착수할 수 있는 자리가 없음.
      // 반면 흑은 (2,2)에 착수하여 W(2,1)을 뒤집을 수 있음!
      const passState: OthelloState = {
        board: passBoard,
        currentPlayerColor: "black",
        result: null,
      };

      expect(hasLegalMoves(passBoard, "white")).toBe(false); // 백은 현재도 둘 곳 없음
      expect(hasLegalMoves(passBoard, "black")).toBe(true); // 흑은 둘 곳 있음

      const res = applyMove(
        passState,
        { type: "place", row: 0, col: 2 },
        "black",
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        // 상대(백)는 여전히 둘 곳이 없고, 흑은 (2,2)에 둘 수 있으므로 흑 차례가 유지되어야 함!
        expect(res.state.currentPlayerColor).toBe("black");
        expect(res.state.result).toBeNull();
      }
    });
  });

  describe("게임 종료 및 승패 판정", () => {
    it("착수로 인해 판 위의 상대 돌이 전멸하거나 양쪽 모두 둘 곳이 없으면 돌 수 비교로 종료된다 (흑 승리)", () => {
      const board = createEmptyBoard();
      // 흑 5개, 백 1개, 흑이 마지막 백돌을 뒤집어 6:0 흑 승리
      board[0][0] = "black";
      board[0][1] = "white";
      board[1][0] = "black";
      board[2][0] = "black";

      const state: OthelloState = {
        board,
        currentPlayerColor: "black",
        result: null,
      };

      const res = applyMove(state, { type: "place", row: 0, col: 2 }, "black");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.state.currentPlayerColor).toBeNull();
        expect(res.state.result).toEqual({
          outcome: "win",
          winner: "black",
          reason: "disc_count",
        });
      }
    });

    it("양쪽 모두 둘 곳이 없을 때 백돌이 더 많으면 백이 승리한다", () => {
      const board = createEmptyBoard();
      // 백돌 여러 개, 흑돌 1개, 백이 착수해 흑돌 하나 뒤집고 게임 종료되는 경우
      board[0][0] = "white";
      board[0][1] = "black";
      board[1][0] = "white";
      board[2][0] = "white";
      board[3][0] = "white";

      const state: OthelloState = {
        board,
        currentPlayerColor: "white",
        result: null,
      };

      const res = applyMove(state, { type: "place", row: 0, col: 2 }, "white");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.state.currentPlayerColor).toBeNull();
        expect(res.state.result).toEqual({
          outcome: "win",
          winner: "white",
          reason: "disc_count",
        });
      }
    });

    it("양쪽 모두 둘 곳이 없을 때 돌 수가 같으면 무승부(draw)가 된다", () => {
      const board = createEmptyBoard();
      // 착수 전:
      // 흑돌: (0,0)=흑
      // 백돌: (0,1)=백 (흑 착수로 뒤집힐 대상)
      // 멀리 떨어진 백돌 3개: (7,5)=백, (7,6)=백, (7,7)=백
      // 흑이 (0,2)에 착수하면 (0,1)이 흑으로 뒤집혀 흑 3개(0,0; 0,1; 0,2), 백 3개(7,5; 7,6; 7,7)가 됨.
      // 양쪽 돌이 완전히 격리되어 더 이상 누구도 상대 돌을 끼울 수 없으므로 동수 무승부 종료.
      board[0][0] = "black";
      board[0][1] = "white";
      board[7][5] = "white";
      board[7][6] = "white";
      board[7][7] = "white";

      const state: OthelloState = {
        board,
        currentPlayerColor: "black",
        result: null,
      };

      const res = applyMove(state, { type: "place", row: 0, col: 2 }, "black");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.state.currentPlayerColor).toBeNull();
        expect(res.state.result).toEqual({
          outcome: "draw",
          reason: "draw",
        });
      }
    });

    it("이미 종료된 게임에 착수를 시도하면 GAME_FINISHED 오류를 반환한다", () => {
      const finishedState: OthelloState = {
        board: createEmptyBoard(),
        currentPlayerColor: null,
        result: { outcome: "win", winner: "black", reason: "disc_count" },
      };

      const res = applyMove(
        finishedState,
        { type: "place", row: 2, col: 3 },
        "black",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("GAME_FINISHED");
      }
    });
  });
});
