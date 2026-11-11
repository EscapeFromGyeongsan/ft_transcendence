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

    it("진행 중인 합법 착수 시 다음 차례를 반환하고 finish는 포함하지 않는다", () => {
      const moves = [
        { row: 2, col: 3, stone: "black" },
        { row: 2, col: 2, stone: "white" },
      ];
      const decision = rules({
        moves,
        seat: "black",
        action: { type: "place", row: 2, col: 1 },
      });
      expect(decision).toEqual({
        ok: true,
        nextTurn: "white",
      });
    });

    it("게임이 종료되는 착수 시 nextTurn: null과 finish 결과를 반환한다", () => {
      // 9수 만에 백돌이 모두 뒤집혀 흑 승리로 종료되는 수순
      const moves = [
        { row: 2, col: 3, stone: "black" },
        { row: 2, col: 2, stone: "white" },
        { row: 2, col: 1, stone: "black" },
        { row: 1, col: 3, stone: "white" },
        { row: 0, col: 4, stone: "black" },
        { row: 5, col: 3, stone: "white" },
        { row: 6, col: 3, stone: "black" },
        { row: 2, col: 4, stone: "white" },
      ];
      const decision = rules({
        moves,
        seat: "black",
        action: { type: "place", row: 3, col: 5 },
      });
      expect(decision).toEqual({
        ok: true,
        nextTurn: null,
        finish: {
          outcome: "win",
          winner: "black",
          reason: "disc_count",
        },
      });
    });

    it("이미 종료된 이력 상태에서 착수하면 GAME_FINISHED 코드를 반환한다", () => {
      const finishedMoves = [
        { row: 2, col: 3, stone: "black" },
        { row: 2, col: 2, stone: "white" },
        { row: 2, col: 1, stone: "black" },
        { row: 1, col: 3, stone: "white" },
        { row: 0, col: 4, stone: "black" },
        { row: 5, col: 3, stone: "white" },
        { row: 6, col: 3, stone: "black" },
        { row: 2, col: 4, stone: "white" },
        { row: 3, col: 5, stone: "black" },
      ];
      const decision = rules({
        moves: finishedMoves,
        seat: "white",
        action: { type: "place", row: 0, col: 0 },
      });
      expect(decision).toEqual({
        ok: false,
        code: "GAME_FINISHED",
      });
    });
  });
});
