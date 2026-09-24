/** Network contracts only: no engine, UI, database or framework imports. */
export interface VersionedGameState {
  readonly stateVersion: number;
}
export type GameResult = {
  kind: "win" | "draw";
  winnerSeats: readonly number[];
  reason: string;
  /** Optional game-specific metric; Omok reports placed stones, not resign commands. */
  moveCount: number | null;
};
export type Player = { id: string; name: string; seat: number; ready: boolean };
export type RoomSnapshot<State = VersionedGameState> = {
  id: string;
  revision: number;
  matchId: string;
  startedAt: string | null;
  finishedAt: string | null;
  title: string;
  gameType: string;
  capacity: number;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  game: State;
  result: GameResult | null;
};
export type ActionRequest = {
  action: unknown;
  expectedVersion: number;
  matchId: string;
};
