import type { Cell, GomokuCommand, GomokuSnapshot } from "../index.ts";

function createEmptyBoard(): Cell[][] {
  return Array.from({ length: 15 }, () => Array<Cell>(15).fill(null));
}

export const initialSnapshot = {
  gameType: "gomoku",
  matchId: "ex-match-1",
  rulesVersion: "gomoku-temp-ver",
  stateVersion: 0,
  status: "playing",
  players: {
    black: "ex-player-1",
    white: "ex-player-2",
  },
  board: createEmptyBoard(),
  currentPlayerId: "ex-player-1",
  result: null,
} satisfies GomokuSnapshot;

export const firstCommand = {
  gameType: "gomoku",
  matchId: "ex-match-1",
  commandId: "ex-command-1",
  expectedVersion: 0,
  action: {
    type: "place",
    row: 4,
    col: 2,
  },
} satisfies GomokuCommand;

const updateBoard = createEmptyBoard();
updateBoard[4][2] = "black";

export const updateSnapshot = {
  ...initialSnapshot,
  stateVersion: 1,
  board: updateBoard,
  currentPlayerId: "ex-player-2",
} satisfies GomokuSnapshot;
