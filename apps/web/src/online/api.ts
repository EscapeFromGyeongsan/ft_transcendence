import type { RoomSnapshot } from "@cafe/game-contracts";
export type OnlineRoom = RoomSnapshot;
export type { ActionRequest } from "@cafe/game-contracts";
export type Membership = { room: OnlineRoom; playerId: string };
export const errorMessages: Record<string, string> = {
  CANNOT_CLOSE_PLAYING:
    "진행 중인 대국은 종료하거나 기권한 뒤 방을 닫아 주세요.",
  LOGIN_REQUIRED: "로그인이 필요해요. 내 계정에서 로그인해 주세요.",
  RESULT_SAVE_FAILED:
    "결과를 저장하지 못했어요. 잠시 후 같은 행동을 다시 시도해 주세요.",
  ROOM_NOT_FOUND: "방이 닫혔어요.",
  UNKNOWN_GAME: "지원하지 않는 게임이에요.",
  ROOM_FULL: "방의 모든 자리가 찼어요.",
  DUPLICATE_NAME: "다른 플레이어 이름을 입력해 주세요.",
  INVALID_NAME: "이름과 방 제목을 확인해 주세요.",
  NOT_A_PLAYER: "참가 정보가 유효하지 않아요. 다시 입장해 주세요.",
  HOST_ONLY: "방장만 할 수 있어요.",
  NOT_READY: "모든 참가자가 준비해야 시작할 수 있어요.",
  WRONG_TURN: "상대의 차례예요.",
  STALE_MATCH: "이미 새로운 대국이에요. 다시 시도해 주세요.",
  STALE_STATE: "화면의 대국 상태가 바뀌었어요. 다시 시도해 주세요.",
  OCCUPIED: "이미 돌이 놓인 자리예요.",
  GAME_FINISHED: "대국이 끝났어요.",
  INVALID_COORDINATE: "판 밖에는 둘 수 없어요.",
  NOT_PLAYING: "대국이 진행 중이지 않아요.",
  NOT_WAITING: "대기 중인 방에서만 할 수 있어요.",
  NOT_FINISHED: "종료된 대국에서만 다시 시작할 수 있어요.",
  CANNOT_LEAVE: "진행 중인 대국에서는 자리를 비울 수 없어요.",
};
export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(`/api/rooms${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      errorMessages[result.error ?? ""] ??
        "서버 요청에 실패했어요. 잠시 후 다시 시도해 주세요.",
    );
  }
  return response.json() as Promise<T>;
}
