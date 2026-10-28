export type {
  GameType,
  PlayerId,
  GameStatus,
  GameCommandBase,
  GameSnapshotBase,
  GameError,
} from "./common.ts";

export type { PlaceAction } from "./actions/place.ts";
export type { ResignAction } from "./actions/resign.ts";
export type {
  PlayerColor,
  Cell,
  TwoColorPlayers,
} from "./shared/two-color-board.ts";
export type { TwoPlayerResult } from "./shared/two-player-result.ts";

export type { GameCommand, GameSnapshot, GameResult } from "./types.ts";

export type {
  GomokuAction,
  GomokuCommand,
  GomokuResult,
  GomokuSnapshot,
} from "./gomoku/types.ts";
export type {
  OthelloAction,
  OthelloCommand,
  OthelloResult,
  OthelloSnapshot,
} from "./othello/types.ts";
