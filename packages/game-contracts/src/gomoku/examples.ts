import type { Cell, GomokuCommand, GomokuSnapshot } from "../index.ts";

function createEmptyBoard(): Cell[][] {
  return Array.from({ length: 15 }, () => Array<Cell>(15).fill(null));
}

export const initialSnapshot = {
  gameType: "gomoku",
  matchId: 1,
  rulesVersion: "gomoku-freestyle-v1",
  stateVersion: 0,
  status: "playing",
  players: {
    black: 101,
    white: 102,
  },
  board: createEmptyBoard(),
  currentPlayerId: 101,
  result: null,
} satisfies GomokuSnapshot;

export const firstCommand = {
  gameType: "gomoku",
  matchId: 1,
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
  currentPlayerId: 102,
} satisfies GomokuSnapshot;

// 첫 착수 후 흑(101)이 기권한다. 기권은 현재 차례와 무관하게 가능하다.
// 행위자는 요청 필드가 아닌 서버 인증 정보에서 확인한다.
export const resignCommand = {
  gameType: "gomoku",
  matchId: 1,
  commandId: "ex-command-2",
  expectedVersion: 1,
  action: { type: "resign" },
} satisfies GomokuCommand;

export const resignedSnapshot = {
  ...updateSnapshot,
  stateVersion: 2,
  status: "finished",
  currentPlayerId: null,
  result: { outcome: "win", winnerId: 102, reason: "resign" },
} satisfies GomokuSnapshot;
