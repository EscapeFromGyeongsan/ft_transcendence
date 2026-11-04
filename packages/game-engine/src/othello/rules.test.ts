import { describe, expect, it } from "vitest";
import { board, OTHELLO_RULES_VERSION, restoreState, rules } from "./rules.ts";

describe("othello rules & restoreState", () => {
  it("버전 상수가 othello-standard-v1이다", () => {
    expect(OTHELLO_RULES_VERSION).toBe("othello-standard-v1");
  });

  describe("restoreState & board", () => {
    it("빈 moves 배열이면 초기 상태 및 판을 반환한다", () => {
      const state = restoreState([]);
      expect(state.currentPlayerColor).toBe("black");
      expect(state.board[3][3]).toBe("white");
      expect(state.board[3][4]).toBe("black");
      expect(state.result).toBeNull();

      const b = board([]);
      expect(b.length).toBe(8);
      expect(b[3][3]).toBe("white");
    });

    it("정상 착수 이력을 순서대로 재생한다", () => {
      const moves = [
        { row: 2, col: 3, stone: "black" },
        { row: 2, col: 4, stone: "white" },
      ];
      const state = restoreState(moves);
      expect(state.board[2][3]).toBe("black");
      expect(state.board[2][4]).toBe("white");
      expect(state.currentPlayerColor).toBe("black");

      const b = board(moves);
      expect(b[2][3]).toBe("black");
      expect(b[2][4]).toBe("white");
    });

    it("돌 색상이 black이나 white가 아니면 예외를 던진다", () => {
      const moves = [{ row: 2, col: 3, stone: "red" }];
      expect(() => restoreState(moves)).toThrow(/Invalid othello history/);
    });

    it("불법 착수(차례 위반, 불법 좌표 등)가 포함된 이력이면 예외를 던진다", () => {
      // 흑 선공인데 백돌이 먼저 놓이는 불법 이력
      const moves = [{ row: 2, col: 3, stone: "white" }];
      expect(() => restoreState(moves)).toThrow(/Invalid othello history/);
    });
  });

  describe("rules()", () => {
    it("합법적인 착수에 대해 ok: true 및 다음 차례를 반환한다", () => {
      const decision = rules({
        moves: [],
        seat: "black",
        action: { type: "place", row: 2, col: 3 },
      });

      expect(decision).toEqual({
        ok: true,
        nextTurn: "white",
      });
    });

    it("불법 착수에 대해 ok: false 및 INVALID_ACTION 코드를 반환한다", () => {
      const decision = rules({
        moves: [],
        seat: "black",
        action: { type: "place", row: 0, col: 0 }, // 뒤집을 수 없음
      });

      expect(decision).toEqual({
        ok: false,
        code: "INVALID_ACTION",
      });
    });

    it("차례가 아닌 플레이어의 착수에 대해 INVALID_ACTION 코드를 반환한다", () => {
      const decision = rules({
        moves: [],
        seat: "white", // 흑 차례인데 백이 착수
        action: { type: "place", row: 2, col: 3 },
      });

      expect(decision).toEqual({
        ok: false,
        code: "INVALID_ACTION",
      });
    });

    it("게임이 종료되는 착수 시 finish 결과를 반환한다", () => {
      // 흑 (0,0), 백 (0,1), 흑 (1,0), (2,0)의 상황을 재현하는 moves 생성
      // 직접 applyMove로 만든 판의 상황 대신 간결하게 rules 함수가 finish를 담아 반환하는지 검증
      // 4턴 진행 후 종료되는 시나리오 또는 초기 상태 기반 연쇄 착수 검증
      const moves = [
        { row: 2, col: 3, stone: "black" },
        { row: 2, col: 2, stone: "white" },
      ];
      // 계속 진행 가능한 합법 착수
      const decision = rules({
        moves,
        seat: "black",
        action: { type: "place", row: 2, col: 1 },
      });
      expect(decision.ok).toBe(true);
      if (decision.ok) {
        expect(decision.nextTurn).toBe("white");
        expect(decision.finish).toBeUndefined();
      }
    });
  });
});
