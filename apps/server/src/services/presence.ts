import type { ConnectionRegistry } from "./connection-registry.ts";

/**
 * 친구 온라인 상태(`presence`)와 친구 관계 변경(`friends.changed`) 알림을
 * 보내는 함수를 만듭니다(#82, SRS FR-SOC-02).
 *
 * @param deps.friendIdsOf - 수락된 친구의 사용자 ID 목록(E, #69의
 *   `listAcceptedFriendIds`)
 * @param deps.onError - 친구 목록 조회 실패를 기록하는 함수
 *
 * @remarks
 * 모든 메시지는 받는 사용자의 인증 완료 연결에만 갑니다. 전송을 놓친
 * 클라이언트는 재연결이나 화면 진입 때 `GET /api/friends`로 다시 조회합니다.
 *
 * 친구 목록 조회 중에 관계가 바뀌면(`notifyFriendsChanged`) 그 조회 결과는
 * 버리고 다시 조회합니다. 그래서 `friends.changed` 뒤에 이미 친구가 아닌
 * 사용자에게 `presence`가 가지 않습니다.
 */
export function createPresence(deps: {
  connections: Pick<ConnectionRegistry, "isUserOnline" | "sendToUser">;
  friendIdsOf: (userId: number) => Promise<number[]>;
  onError: (error: unknown) => void;
}) {
  // Bumped for both users on every friendship change. A friend list read
  // across a bump may hold a relationship that no longer exists.
  const generations = new Map<number, number>();
  const generationOf = (userId: number) => generations.get(userId) ?? 0;
  const MAX_LOOKUPS = 5;

  return {
    /**
     * 사용자의 온라인 상태를 수락된 친구들에게 알립니다. 연결 수가
     * 0 ↔ 1 이상으로 바뀔 때 호출합니다.
     *
     * @remarks
     * 친구 조회는 비동기라 짧은 시간에 연달아 바뀌면 알림 순서가 섞일 수
     * 있습니다. 그래서 `online`에는 바뀐 순간이 아니라 보내는 순간의 상태를
     * 담습니다. 순서가 섞여도 마지막 알림은 현재 상태와 같습니다.
     *
     * 조회하는 동안 이 사용자의 친구 관계가 바뀌면 다시 조회합니다. 계속
     * 바뀌어 5번 안에 안정된 목록을 얻지 못하면 보내지 않습니다. 그때는
     * 이미 `friends.changed`를 받은 클라이언트가 목록을 다시 조회합니다.
     */
    async notifyPresence(userId: number) {
      let friendIds: number[] | undefined;
      for (let lookup = 0; lookup < MAX_LOOKUPS && !friendIds; lookup++) {
        const generation = generationOf(userId);
        let ids: number[];
        try {
          ids = await deps.friendIdsOf(userId);
        } catch (error) {
          deps.onError(error);
          return;
        }
        if (generationOf(userId) === generation) friendIds = ids;
      }
      if (!friendIds) return;
      const online = deps.connections.isUserOnline(userId);
      for (const friendId of friendIds) {
        deps.connections.sendToUser(friendId, {
          type: "presence",
          payload: { userId, online },
        });
      }
    },

    /**
     * 두 사용자의 모든 연결에 친구 관계가 바뀌었다고 알립니다. 요청·수락·
     * 거절·삭제가 DB에 반영된 뒤 친구 서비스가 호출합니다.
     */
    notifyFriendsChanged(userIdA: number, userIdB: number) {
      for (const userId of new Set([userIdA, userIdB])) {
        generations.set(userId, generationOf(userId) + 1);
        deps.connections.sendToUser(userId, {
          type: "friends.changed",
          payload: {},
        });
      }
    },
  };
}

export type Presence = ReturnType<typeof createPresence>;
