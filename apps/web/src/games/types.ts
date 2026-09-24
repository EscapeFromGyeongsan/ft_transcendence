import type { RoomSnapshot, Player } from "@cafe/game-contracts";
export type OnlineGameProps = {
  room: RoomSnapshot;
  self?: Player;
  pending: boolean;
  connected: boolean;
  onAction: (action: unknown) => void;
  onError: (message: string) => void;
};
