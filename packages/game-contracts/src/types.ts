import type {
  GomokuCommand,
  GomokuResult,
  GomokuSnapshot,
} from "./gomoku/types.ts";
import type {
  OthelloCommand,
  OthelloResult,
  OthelloSnapshot,
} from "./othello/types.ts";

export type GameCommand = GomokuCommand | OthelloCommand;
export type GameSnapshot = GomokuSnapshot | OthelloSnapshot;
export type GameResult = GomokuResult | OthelloResult;
