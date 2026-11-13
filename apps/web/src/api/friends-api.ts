import { authApi, type RequestOptions } from "./auth-client.ts";
import { ApiError, getErrorMessage } from "./errors.ts";

/** PR #95 친구·요청 공통 사용자 정보입니다. 이메일은 표시하지 않습니다. */
export interface FriendUser {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
}

/** 마지막 조회 시점의 온라인 상태이며, null은 B 검토안의 집계 불가 값으로 보존합니다. */
export interface FriendEntry extends FriendUser {
  online: boolean | null;
}

/** 받은/보낸 pending 요청입니다. 수락·거절은 userId 대신 이 요청의 ID를 사용합니다. */
export interface FriendRequest extends FriendUser {
  requestId: number;
  createdAt: string;
}

/** 한 번의 재조회로 함께 갱신하는 세 종류의 친구 목록입니다. */
export interface FriendsList {
  friends: FriendEntry[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

/** 요청 생성·맞요청 수락·명시적 수락의 확인 응답입니다. */
export interface FriendRequestResult extends FriendUser {
  requestId: number;
  status: "pending" | "accepted";
}

type RequestFn = <T>(path: string, options?: RequestOptions) => Promise<T>;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const user = (value: unknown): value is JsonObject & FriendUser =>
  object(value) &&
  id(value.userId) &&
  typeof value.nickname === "string" &&
  value.nickname.length > 0 &&
  value.nickname.length <= 32 &&
  (value.avatarUrl === null || typeof value.avatarUrl === "string");
const pickUser = (value: FriendUser): FriendUser => ({
  userId: value.userId,
  nickname: value.nickname,
  avatarUrl: value.avatarUrl,
});

function invalid(): never {
  throw new ApiError(
    502,
    "FRIENDS_INVALID_RESPONSE",
    "Invalid friends response.",
  );
}

/** 친구 오류를 사용자 안내로 변환합니다. API 미제공도 빈 목록으로 취급하지 않습니다. */
export function getFriendsErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return getErrorMessage(error);
  const messages: Record<string, string> = {
    REQUEST_DECLINED: "이 사용자에게는 친구 요청을 다시 보낼 수 없습니다.",
    REQUEST_PENDING: "이미 친구 요청을 보냈습니다. 목록을 다시 확인해 주세요.",
    ALREADY_FRIENDS: "이미 친구인 사용자입니다. 목록을 다시 확인해 주세요.",
    USER_NOT_FOUND:
      "사용자를 찾을 수 없습니다. 검색 결과를 다시 확인해 주세요.",
    FRIEND_REQUEST_CONFLICT:
      "친구 관계가 변경되었습니다. 목록을 다시 확인해 주세요.",
    FRIENDS_INVALID_RESPONSE:
      "친구 정보를 확인할 수 없습니다. 목록을 다시 불러와 주세요.",
    FRIENDS_TIMEOUT:
      "응답 시간이 초과되어 처리 결과를 확인하지 못했습니다. 최신 목록을 확인해 주세요.",
  };
  if (messages[error.code]) return messages[error.code];
  if (error.status === 404)
    return "친구 정보를 찾을 수 없습니다. 목록을 다시 불러와 주세요.";
  if (error.status === 403) return "이 친구 요청을 처리할 권한이 없습니다.";
  if (error.status === 409)
    return "친구 관계가 변경되었습니다. 목록을 다시 확인해 주세요.";
  return getErrorMessage(error);
}

/**
 * PR #95의 친구 REST 응답을 검증하고 각 요청의 대기를 15초로 제한합니다.
 *
 * @remarks
 * 제한 시간이 지나면 처리 결과를 확정하지 않습니다. 공유 refresh는 유지하되 취소된 요청은 재전송하지 않습니다.
 * 현재 #95는 온라인 집계 미연결 시 503을 반환하며, null 호환 처리가 이를 성공 응답으로 바꾸지는 않습니다.
 */
export function createFriendsApi(send: RequestFn) {
  async function request<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new ApiError(
          408,
          "FRIENDS_TIMEOUT",
          "Friends request timed out.",
        );
        controller.abort(error);
        reject(error);
      }, 15_000);
    });
    try {
      // 공유 refresh는 취소하지 않고, 친구 요청의 대기와 후속 fetch만 종료합니다.
      return await Promise.race([
        send<T>(path, { ...options, signal: controller.signal }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestResult(path: string, body?: { userId: number }) {
    const value = await request<unknown>(path, { method: "POST", body });
    if (
      !user(value) ||
      !id(value.requestId) ||
      (value.status !== "pending" && value.status !== "accepted")
    )
      return invalid();
    return {
      ...pickUser(value),
      requestId: value.requestId,
      status: value.status,
    } as FriendRequestResult;
  }
  return {
    async getFriends(): Promise<FriendsList> {
      const value = await request<unknown>("/api/friends");
      if (
        !object(value) ||
        !Array.isArray(value.friends) ||
        !Array.isArray(value.incoming) ||
        !Array.isArray(value.outgoing)
      )
        return invalid();
      const friends = value.friends.map((entry) => {
        if (
          !user(entry) ||
          (typeof entry.online !== "boolean" && entry.online !== null)
        )
          return invalid();
        return { ...pickUser(entry), online: entry.online };
      });
      const requests = (entries: unknown[]): FriendRequest[] =>
        entries.map((entry) => {
          if (
            !user(entry) ||
            !id(entry.requestId) ||
            typeof entry.createdAt !== "string" ||
            !Number.isFinite(Date.parse(entry.createdAt))
          )
            return invalid();
          return {
            ...pickUser(entry),
            requestId: entry.requestId,
            createdAt: entry.createdAt,
          };
        });
      return {
        friends,
        incoming: requests(value.incoming),
        outgoing: requests(value.outgoing),
      };
    },
    async searchUsers(nickname: string): Promise<FriendUser[]> {
      const query = new URLSearchParams({ nickname: nickname.trim() });
      const value = await request<unknown>(`/api/users?${query}`);
      if (!Array.isArray(value) || value.length > 20) return invalid();
      return value.map((entry) => {
        if (!object(entry) || !user({ ...entry, userId: entry.id }))
          return invalid();
        return pickUser({
          userId: entry.id as number,
          nickname: entry.nickname as string,
          avatarUrl: entry.avatarUrl as string | null,
        });
      });
    },
    async sendRequest(userId: number) {
      const result = await requestResult("/api/friends/requests", { userId });
      if (result.userId !== userId) return invalid();
      return result;
    },
    async acceptRequest(requestId: number) {
      const result = await requestResult(
        `/api/friends/requests/${requestId}/accept`,
      );
      if (result.requestId !== requestId || result.status !== "accepted")
        return invalid();
      return result;
    },
    declineRequest: (requestId: number) =>
      request<void>(`/api/friends/requests/${requestId}/decline`, {
        method: "POST",
      }),
    removeFriend: (userId: number) =>
      request<void>(`/api/friends/${userId}`, { method: "DELETE" }),
  };
}

export type FriendsApi = ReturnType<typeof createFriendsApi>;
export const friendsApi = createFriendsApi((path, options) =>
  authApi.request(path, options),
);
