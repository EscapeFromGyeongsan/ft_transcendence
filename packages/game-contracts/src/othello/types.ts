import type { PlaceAction } from "../actions/place.ts";
import type { GameCommandBase, GameSnapshotBase, PlayerId } from "../common.ts";
import type { Cell, TwoColorPlayers } from "../shared/two-color-board.ts";
import type { TwoPlayerResult } from "../shared/two-player-result.ts";

export type OthelloAction = PlaceAction;
export type OthelloResult = TwoPlayerResult<"disc_count">;

export interface OthelloCommand extends GameCommandBase {
  gameType: "othello";
  action: OthelloAction;
}

export interface OthelloSnapshot extends GameSnapshotBase {
  gameType: "othello";
  players: TwoColorPlayers;
  // 오델로 보드의 8×8 크기는 게임 엔진에서 검증한다.
  board: Cell[][];
  currentPlayerId: PlayerId | null;
  result: OthelloResult | null;
}
