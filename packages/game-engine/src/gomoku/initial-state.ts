import type { Cell } from "@cafe/game-contracts";
import type { GomokuState } from "./types.ts";

export const GOMOKU_BOARD_SIZE = 15;

export function createInitialState(): GomokuState {
  return {
    board: Array.from({ length: GOMOKU_BOARD_SIZE }, () =>
      Array<Cell>(GOMOKU_BOARD_SIZE).fill(null),
    ),
    currentPlayerColor: "black",
  };
}
