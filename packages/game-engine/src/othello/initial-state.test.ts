import { describe, expect, it } from "vitest";
import { createInitialState, OTHELLO_BOARD_SIZE } from "./initial-state.ts";

describe("othello createInitialState", () => {
  it("8×8 크기의 보드를 생성한다", () => {
    const state = createInitialState();
    expect(state.board.length).toBe(OTHELLO_BOARD_SIZE);
    expect(state.board.length).toBe(8);
    for (const row of state.board) {
      expect(row.length).toBe(OTHELLO_BOARD_SIZE);
    }
  });

  it("중앙 4개 칸에 표준 배치를 설정한다: (3,3) 백, (3,4) 흑, (4,3) 흑, (4,4) 백", () => {
    const state = createInitialState();
    expect(state.board[3][3]).toBe("white");
    expect(state.board[3][4]).toBe("black");
    expect(state.board[4][3]).toBe("black");
    expect(state.board[4][4]).toBe("white");
  });

  it("중앙 4개 외의 모든 칸은 null이다", () => {
    const state = createInitialState();
    for (let r = 0; r < OTHELLO_BOARD_SIZE; r++) {
      for (let c = 0; c < OTHELLO_BOARD_SIZE; c++) {
        if ((r === 3 || r === 4) && (c === 3 || c === 4)) {
          continue;
        }
        expect(state.board[r][c]).toBeNull();
      }
    }
  });

  it("선공은 흑이며 결과는 null이다", () => {
    const state = createInitialState();
    expect(state.currentPlayerColor).toBe("black");
    expect(state.result).toBeNull();
  });
});
