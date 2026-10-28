import type { PlaceAction } from "../actions/place.ts";
import type { ResignAction } from "../actions/resign.ts";
import type { GameCommandBase, GameSnapshotBase, PlayerId } from "../common.ts";
import type { Cell, TwoColorPlayers } from "../shared/two-color-board.ts";
import type { TwoPlayerResult } from "../shared/two-player-result.ts";

export type GomokuAction = PlaceAction | ResignAction;
export type GomokuResult = TwoPlayerResult<"five_in_row">;

export interface GomokuCommand extends GameCommandBase {
  gameType: "gomoku";
  action: GomokuAction;
}

export interface GomokuSnapshot extends GameSnapshotBase {
  gameType: "gomoku";
  players: TwoColorPlayers;
  // 오목 보드의 15×15 크기는 게임 엔진에서 검증한다.
  board: Cell[][];
  currentPlayerId: PlayerId | null;
  result: GomokuResult | null;
}
