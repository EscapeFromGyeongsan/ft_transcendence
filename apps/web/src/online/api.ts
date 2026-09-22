import type { OmokAction, OmokState } from "@cafe/omok";
import type { RoomPlayer, RoomStatus } from "../rooms/types";

export type OnlineRoom = {
  id: string;
  title: string;
  gameType: "omok";
  capacity: 2;
  status: RoomStatus;
  players: RoomPlayer[];
  game: OmokState;
};
export type Membership = { room: OnlineRoom; token: string; playerId: string };
const errorMessages: Record<string, string> = {
  ROOM_NOT_FOUND: "방이 닫혔어요.",
  ROOM_FULL: "이미 두 명이 입장했어요.",
  DUPLICATE_NAME: "다른 플레이어 이름을 입력해 주세요.",
  INVALID_NAME: "이름과 방 제목을 확인해 주세요.",
  NOT_A_PLAYER: "참가 정보가 유효하지 않아요. 다시 입장해 주세요.",
  HOST_ONLY: "방장만 할 수 있어요.",
  NOT_READY: "두 명 모두 준비해야 시작할 수 있어요.",
  WRONG_TURN: "상대의 차례예요.",
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
const key = (id: string) => `cafe-online-room-${id}`;
export function saveMembership(
  id: string,
  value: Pick<Membership, "token" | "playerId">,
) {
  sessionStorage.setItem(key(id), JSON.stringify(value));
}
export function membership(
  id: string,
): Pick<Membership, "token" | "playerId"> | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(id)) ?? "null") as Pick<
      Membership,
      "token" | "playerId"
    > | null;
    return value &&
      typeof value.token === "string" &&
      typeof value.playerId === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export function forgetMembership(id: string) {
  sessionStorage.removeItem(key(id));
}
export type ActionRequest = { action: OmokAction; expectedVersion: number };
