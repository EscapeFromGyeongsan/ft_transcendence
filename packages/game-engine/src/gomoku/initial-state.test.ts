import { describe, expect, it } from "vitest";
import { gomoku } from "@cafe/game-engine";

describe("gomoku.createInitialState", () => {
  it("creates a 15 by 15 empty board", () => {
    const state = gomoku.createInitialState();

    expect(state.board).toHaveLength(15);
    for (const row of state.board) {
      expect(row).toHaveLength(15);
      expect(row.every((cell) => cell === null)).toBe(true);
    }
  });

  it("gives black the first turn", () => {
    expect(gomoku.createInitialState().currentPlayerColor).toBe("black");
    expect(gomoku.createInitialState().result).toBeNull();
  });

  it("keeps board rows independent", () => {
    const state = gomoku.createInitialState();
    state.board[0][0] = "black";

    expect(state.board[0][0]).toBe("black");
    expect(state.board[0][1]).toBeNull();
    for (const row of state.board.slice(1)) {
      expect(row.every((cell) => cell === null)).toBe(true);
    }
  });

  it("creates independent state for each game", () => {
    const first = gomoku.createInitialState();
    const second = gomoku.createInitialState();

    first.board[4][2] = "black";
    first.currentPlayerColor = "white";

    expect(second.board[4][2]).toBeNull();
    expect(second.board.flat().every((cell) => cell === null)).toBe(true);
    expect(second.currentPlayerColor).toBe("black");
  });
});
