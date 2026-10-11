import type { Cell, PlayerColor } from "@cafe/game-contracts";

// 오목 규칙에 필요한 상태. 경기 ID와 전송 버전은 상위 계층에서 관리한다.
export interface GomokuState {
  board: Cell[][];
  currentPlayerColor: PlayerColor;
}
