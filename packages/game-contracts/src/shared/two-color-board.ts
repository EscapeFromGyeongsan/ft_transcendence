import type { PlayerId } from "../common.ts";

// 흑·백 보드를 사용하는 게임의 선택형 공유 타입.
export type PlayerColor = "black" | "white";
export type Cell = PlayerColor | null;

export type TwoColorPlayers = {
  black: PlayerId;
  white: PlayerId;
};
