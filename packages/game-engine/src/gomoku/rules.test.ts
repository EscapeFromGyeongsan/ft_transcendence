import { describe, expect, it } from "vitest";
import { gomoku } from "@cafe/game-engine";

const winningMoves = Array.from({ length: 9 }, (_, i) => ({
  row: i % 2 === 0 ? 0 : 14,
  col: Math.floor(i / 2),
  stone: i % 2 === 0 ? "black" : "white",
}));

describe("gomoku server rules adapter", () => {
  it("keeps resignation outside the rules callback", () => {
    const moves = Object.freeze(winningMoves.slice(0, 1));
    const before = structuredClone(moves);
    const input = {
      moves,
      seat: "white" as const,
      action: { type: "resign" as const },
    };

    // @ts-expect-error The match service handles resignation before calling rules.
    expect(gomoku.rules(input)).toEqual({ ok: false, code: "INVALID_ACTION" });
    expect(moves).toEqual(before);
    expect(gomoku.restoreState(moves)).toMatchObject({
      currentPlayerColor: "white",
      result: null,
    });
  });

  it("matches the server's rules callback and replays history without changing it", () => {
    const moves = winningMoves.slice(0, 8);
    const before = structuredClone(moves);
    for (const move of moves) Object.freeze(move);
    Object.freeze(moves);
    expect(
      gomoku.rules({
        moves,
        seat: "black",
        action: { type: "place", row: 0, col: 4 },
      }),
    ).toEqual({
      ok: true,
      nextTurn: null,
      finish: { outcome: "win", winner: "black", reason: "five_in_row" },
    });
    expect(moves).toEqual(before);
    expect(gomoku.restoreState(moves)).toMatchObject({
      currentPlayerColor: "black",
      result: null,
    });
  });

  it("returns the next turn and rejects illegal current commands", () => {
    const moves = winningMoves.slice(0, 1);
    expect(
      gomoku.rules({
        moves,
        seat: "white",
        action: { type: "place", row: 1, col: 0 },
      }),
    ).toEqual({ ok: true, nextTurn: "black" });
    for (const input of [
      {
        moves,
        seat: "black" as const,
        action: { type: "place" as const, row: 1, col: 0 },
      },
      {
        moves,
        seat: "white" as const,
        action: { type: "place" as const, row: 0, col: 0 },
      },
      {
        moves,
        seat: "white" as const,
        action: { type: "place" as const, row: 15, col: 0 },
      },
    ])
      expect(gomoku.rules(input)).toEqual({
        ok: false,
        code: "INVALID_ACTION",
      });
  });

  it("restores a finished game and refuses further placements", () => {
    expect(gomoku.restoreState(winningMoves).result).toMatchObject({
      outcome: "win",
      winner: "black",
    });
    expect(
      gomoku.rules({
        moves: winningMoves,
        seat: "white",
        action: { type: "place", row: 1, col: 1 },
      }),
    ).toEqual({ ok: false, code: "GAME_FINISHED" });
  });

  it("rebuilds the snapshot board from stored moves", () => {
    expect(gomoku.board([])).toEqual(
      Array.from({ length: 15 }, () => Array(15).fill(null)),
    );

    const moves = Object.freeze(winningMoves.slice(0, 2));
    const before = structuredClone(moves);
    const board = gomoku.board(moves);
    expect(board).toHaveLength(15);
    expect(board.every((line) => line.length === 15)).toBe(true);
    expect(board[0][0]).toBe("black");
    expect(board[14][0]).toBe("white");
    expect(board.flat().filter((cell) => cell !== null)).toHaveLength(2);
    expect(moves).toEqual(before);
  });

  it("refuses to draw a board from corrupt history", () => {
    expect(() =>
      gomoku.board([
        { row: 0, col: 0, stone: "black" },
        { row: 0, col: 0, stone: "white" },
      ]),
    ).toThrow("Invalid gomoku history at move 2");
  });

  it.each([
    [{ row: 0, col: 0, stone: "white" }],
    [{ row: 0, col: 0, stone: "other" }],
    [{ row: 15, col: 0, stone: "black" }],
    [
      { row: 0, col: 0, stone: "black" },
      { row: 0, col: 0, stone: "white" },
    ],
    [...winningMoves, { row: 1, col: 1, stone: "white" }],
  ])("throws for corrupt history: %j", (...moves) => {
    expect(() => gomoku.restoreState(moves)).toThrow("Invalid gomoku history");
  });
});
