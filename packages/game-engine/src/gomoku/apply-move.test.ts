import { describe, expect, it } from "vitest";
import type { PlayerColor } from "@cafe/game-contracts";
import { gomoku } from "@cafe/game-engine";

function freezeState(state: gomoku.GomokuState): void {
  for (const row of state.board) Object.freeze(row);
  Object.freeze(state.board);
  Object.freeze(state);
}

describe("gomoku.applyMove", () => {
  it("places one black stone without modifying the input and gives white the turn", () => {
    const state = gomoku.createInitialState();
    const before = structuredClone(state);
    freezeState(state);

    const result = gomoku.applyMove(
      state,
      { type: "place", row: 4, col: 2 },
      "black",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a successful move");
    expect(result.state.board[4][2]).toBe("black");
    expect(result.state.board.flat().filter((cell) => cell !== null)).toEqual([
      "black",
    ]);
    expect(result.state.currentPlayerColor).toBe("white");
    expect(state).toEqual(before);
  });

  it("keeps the black stone, places white and gives black the next turn", () => {
    const first = gomoku.applyMove(
      gomoku.createInitialState(),
      { type: "place", row: 4, col: 2 },
      "black",
    );
    if (!first.ok) throw new Error("Expected a successful first move");
    const before = structuredClone(first.state);
    freezeState(first.state);

    const second = gomoku.applyMove(
      first.state,
      { type: "place", row: 4, col: 3 },
      "white",
    );

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("Expected a successful second move");
    expect(second.state.board[4][2]).toBe("black");
    expect(second.state.board[4][3]).toBe("white");
    expect(second.state.board.flat().filter((cell) => cell !== null)).toEqual([
      "black",
      "white",
    ]);
    expect(second.state.currentPlayerColor).toBe("black");
    expect(first.state).toEqual(before);
  });

  it.each([
    [0, 0],
    [0, 14],
    [14, 0],
    [14, 14],
  ])("accepts the corner at row %i, col %i", (row, col) => {
    const result = gomoku.applyMove(
      gomoku.createInitialState(),
      { type: "place", row, col },
      "black",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a legal corner move");
    expect(result.state.board[row][col]).toBe("black");
    expect(result.state.currentPlayerColor).toBe("white");
  });

  it.each([
    [-1, 2],
    [15, 2],
    [0.5, 2],
    [NaN, 2],
    [Infinity, 2],
    [-Infinity, 2],
    [4, -1],
    [4, 15],
    [4, 0.5],
    [4, NaN],
    [4, Infinity],
    [4, -Infinity],
  ])(
    "rejects invalid coordinates row %s, col %s without changing state",
    (row, col) => {
      const state = gomoku.createInitialState();
      state.board[10][7] = "white";
      const before = structuredClone(state);
      freezeState(state);

      const result = gomoku.applyMove(
        state,
        { type: "place", row, col },
        "black",
      );

      expect(result).toEqual({
        ok: false,
        error: { code: "INVALID_ACTION", message: expect.any(String) },
      });
      expect(state).toEqual(before);
    },
  );

  it.each<PlayerColor>(["black", "white"])(
    "rejects a cell occupied by %s without changing state",
    (occupiedColor) => {
      const state = gomoku.createInitialState();
      state.board[4][2] = occupiedColor;
      const before = structuredClone(state);
      freezeState(state);

      const result = gomoku.applyMove(
        state,
        { type: "place", row: 4, col: 2 },
        "black",
      );

      expect(result).toEqual({
        ok: false,
        error: { code: "INVALID_ACTION", message: expect.any(String) },
      });
      expect(state).toEqual(before);
    },
  );

  it.each<PlayerColor>(["black", "white"])(
    "rejects %s when it is the other player's turn without changing state",
    (playerColor) => {
      const state = gomoku.createInitialState();
      state.currentPlayerColor = playerColor === "black" ? "white" : "black";
      const before = structuredClone(state);
      freezeState(state);

      const result = gomoku.applyMove(
        state,
        { type: "place", row: 4, col: 2 },
        playerColor,
      );

      expect(result).toEqual({
        ok: false,
        error: { code: "INVALID_ACTION", message: expect.any(String) },
      });
      expect(state).toEqual(before);
    },
  );

  it("keeps all returned board rows independent of the input", () => {
    const state = gomoku.createInitialState();
    state.board[3][3] = "white";
    const result = gomoku.applyMove(
      state,
      { type: "place", row: 4, col: 2 },
      "black",
    );
    if (!result.ok) throw new Error("Expected a successful move");

    result.state.board[4][2] = "white";
    result.state.board[4][3] = "white";
    for (const row of result.state.board) row[0] = "black";
    expect(state.board[4][2]).toBeNull();
    expect(state.board[4][3]).toBeNull();
    expect(state.board.every((row) => row[0] === null)).toBe(true);

    state.board[3][3] = "black";
    expect(result.state.board[3][3]).toBe("white");
    expect(state.currentPlayerColor).toBe("black");
  });
});
