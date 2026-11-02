import { describe, expect, it } from "vitest";
import type { PlayerColor } from "@cafe/game-contracts";
import { gomoku } from "@cafe/game-engine";

function play(state: gomoku.GomokuState, row: number, col: number) {
  if (!state.currentPlayerColor) throw new Error("Game already finished");
  const result = gomoku.applyMove(
    state,
    { type: "place", row, col },
    state.currentPlayerColor,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

describe("gomoku finish", () => {
  it.each([
    [0, 1, 0, 0],
    [1, 0, 0, 14],
    [1, 1, 0, 0],
    [1, -1, 0, 14],
  ])(
    "detects both colors winning along (%i, %i) from (%i, %i)",
    (dr, dc, r, c) => {
      for (const color of ["black", "white"] as PlayerColor[]) {
        const state = gomoku.createInitialState();
        state.currentPlayerColor = color;
        // 빈칸 양쪽을 합쳐 세어야 하며 보드 가장자리까지 포함한다.
        for (const i of [0, 1, 3, 4])
          state.board[r + dr * i][c + dc * i] = color;
        const before = structuredClone(state);
        const next = play(state, r + dr * 2, c + dc * 2);
        expect(next.result).toEqual({
          outcome: "win",
          winner: color,
          reason: "five_in_row",
        });
        expect(next.currentPlayerColor).toBeNull();
        expect(state).toEqual(before);
        const frozen = structuredClone(next);
        expect(
          gomoku.applyMove(next, { type: "place", row: 7, col: 7 }, color),
        ).toMatchObject({
          ok: false,
          error: { code: "GAME_FINISHED" },
        });
        expect(next).toEqual(frozen);
      }
    },
  );

  it("allows overlines and a double three without forbidden moves", () => {
    const state = gomoku.createInitialState();
    for (const c of [0, 1, 2, 4, 5]) state.board[0][c] = "black";
    expect(play(state, 0, 3).result).toEqual({
      outcome: "win",
      winner: "black",
      reason: "five_in_row",
    });

    const doubleThree = gomoku.createInitialState();
    for (const [r, c] of [
      [7, 6],
      [7, 8],
      [6, 7],
      [8, 7],
    ])
      doubleThree.board[r][c] = "black";
    expect(play(doubleThree, 7, 7)).toMatchObject({
      currentPlayerColor: "white",
      result: null,
    });
  });

  it("does not join stones across a gap, another color or a row boundary", () => {
    const state = gomoku.createInitialState();
    for (const c of [0, 1, 3, 4, 7, 8]) state.board[0][c] = "black";
    state.board[0][2] = "white";
    state.board[1][0] = "black";
    state.board[1][1] = "black";
    expect(play(state, 0, 14).result).toBeNull();
    expect(play(state, 0, 5).result).toBeNull();

    const boundary = gomoku.createInitialState();
    for (const [r, c] of [
      [0, 13],
      [0, 14],
      [1, 0],
      [1, 1],
    ]) {
      boundary.board[r][c] = "black";
    }
    expect(play(boundary, 1, 2).result).toBeNull();
  });

  it("plays a complete legal 225-move draw and refuses further moves", () => {
    // 이 배치는 가로·세로·두 대각선 모두 연속 5개가 없고 흑 113/백 112칸이다.
    const cells: Record<PlayerColor, { row: number; col: number }[]> = {
      black: [],
      white: [],
    };
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 15; col++) {
        cells[(row + 2 * col) % 4 < 2 ? "black" : "white"].push({ row, col });
      }
    }
    let state = gomoku.createInitialState();
    for (let i = 0; i < 225; i++) {
      const cell = cells[i % 2 === 0 ? "black" : "white"][Math.floor(i / 2)];
      state = play(state, cell.row, cell.col);
      if (i < 224) expect(state.result).toBeNull();
    }
    expect(state.result).toEqual({ outcome: "draw", reason: "draw" });
    expect(state.currentPlayerColor).toBeNull();
    const before = structuredClone(state);
    expect(
      gomoku.applyMove(state, { type: "place", row: 0, col: 0 }, "black"),
    ).toMatchObject({
      ok: false,
      error: { code: "GAME_FINISHED" },
    });
    expect(state).toEqual(before);
  });

  it("gives a win priority over a full board draw", () => {
    const state = gomoku.createInitialState();
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++)
        state.board[r][c] = (r + 2 * c) % 4 < 2 ? "black" : "white";
    }
    for (let c = 0; c < 4; c++) state.board[0][c] = "black";
    state.board[0][4] = null;
    expect(play(state, 0, 4).result).toEqual({
      outcome: "win",
      winner: "black",
      reason: "five_in_row",
    });
  });
});
