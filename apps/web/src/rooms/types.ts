export type RoomStatus = "waiting" | "playing" | "finished";
export interface RoomPlayer {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
}
/** Room metadata is separate from the game engine's board and turn rules. */
export interface Room {
  id: string;
  title: string;
  gameType: "omok";
  capacity: number;
  status: RoomStatus;
  players: RoomPlayer[];
}
export interface CreateRoomInput {
  gameType?: string;
  title: string;
  hostName: string;
}
export const roomStatusLabels: Record<RoomStatus, string> = {
  waiting: "대기 중",
  playing: "대국 중",
  finished: "대국 종료",
};
export const ROOM_TITLE_LIMIT = 40;
export const PLAYER_NAME_LIMIT = 16;
