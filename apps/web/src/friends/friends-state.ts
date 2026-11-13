import {
  getFriendsErrorMessage,
  type FriendsApi,
  type FriendsList,
  type FriendUser,
} from "../api/friends-api.ts";

/** 최신 목록의 requestId로 변경하며 서버 응답 전에 관계를 확정하지 않습니다. */
export type FriendAction =
  | { kind: "request"; userId: number }
  | { kind: "accept" | "decline"; userId: number; requestId: number }
  | { kind: "remove"; userId: number };

/** 계정별 화면 수명에만 유지하는 상태입니다. data=null은 조회 성공의 빈 목록과 구분합니다. */
export interface FriendsState {
  data: FriendsList | null;
  loading: boolean;
  stale: boolean;
  listError: string | null;
  query: string;
  results: FriendUser[] | null;
  searching: boolean;
  searchError: string | null;
  pending: FriendAction | null;
  notice: string | null;
  actionError: string | null;
  connected: boolean;
  onlineFresh: boolean;
}

const initialState = (): FriendsState => ({
  data: null,
  loading: false,
  stale: true,
  listError: null,
  query: "",
  results: null,
  searching: false,
  searchError: null,
  pending: null,
  notice: null,
  actionError: null,
  connected: false,
  onlineFresh: false,
});

/**
 * 화면 수명에 속하는 친구 상태를 관리합니다. 조회를 직렬화하며 변경 뒤에는 재조회합니다.
 * stop 이후 또는 이전 검색의 응답은 버리고, 서버 성공과 후속 조회 실패를 구분합니다.
 */
export function createFriendsController(
  api: FriendsApi,
  currentUserId: number,
) {
  let state = initialState();
  let active = false;
  let epoch = 0;
  let searchVersion = 0;
  let listVersion = 0;
  let dirty = false;
  let flight: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const patch = (changes: Partial<FriendsState>) => {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  };
  const alive = (generation: number) => active && epoch === generation;

  async function readList(
    generation: number,
    afterMutation: boolean,
  ): Promise<boolean> {
    let success = false;
    try {
      do {
        dirty = false;
        const version = listVersion;
        patch({
          loading: true,
          stale: true,
          onlineFresh: false,
          listError: null,
        });
        try {
          const data = await api.getFriends();
          if (!alive(generation)) return false;
          if (version === listVersion) {
            success = true;
            patch({ data, stale: false, onlineFresh: state.connected });
          }
        } catch (error) {
          if (!alive(generation)) return false;
          patch({
            listError: getFriendsErrorMessage(error),
            stale: true,
            onlineFresh: false,
          });
          // An event stream must not turn an outage into an immediate retry loop.
          dirty = false;
          return false;
        }
      } while (dirty && alive(generation) && (!state.pending || afterMutation));
      return success;
    } finally {
      if (alive(generation)) {
        flight = null;
        patch({ loading: false });
      }
    }
  }

  function refresh(afterMutation = false): Promise<boolean> {
    if (!active) return Promise.resolve(false);
    listVersion++;
    dirty = true;
    patch({ stale: true, onlineFresh: false });
    if (state.pending && !afterMutation) return Promise.resolve(false);
    if (flight) return flight;
    flight = readList(epoch, afterMutation);
    return flight;
  }

  function setQuery(query: string) {
    searchVersion++;
    patch({ query, results: null, searchError: null, searching: false });
  }

  async function search() {
    if (!active) return;
    const version = ++searchVersion;
    const generation = epoch;
    const query = state.query.trim();
    if (!query || query.length > 32) {
      patch({
        searchError: "검색할 닉네임을 1~32자로 입력해 주세요.",
        results: null,
        searching: false,
      });
      return;
    }
    patch({ searching: true, results: null, searchError: null });
    try {
      const results = await api.searchUsers(query);
      if (alive(generation) && version === searchVersion)
        patch({
          results: results.filter((entry) => entry.userId !== currentUserId),
        });
    } catch (error) {
      if (alive(generation) && version === searchVersion)
        patch({ searchError: getFriendsErrorMessage(error) });
    } finally {
      if (alive(generation) && version === searchVersion)
        patch({ searching: false });
    }
  }

  async function perform(action: FriendAction): Promise<boolean> {
    if (
      !active ||
      state.pending ||
      state.stale ||
      !state.data ||
      action.userId === currentUserId
    )
      return false;
    if (
      (action.kind === "accept" || action.kind === "decline") &&
      !state.data.incoming.some(
        (entry) =>
          entry.userId === action.userId &&
          entry.requestId === action.requestId,
      )
    ) {
      patch({
        actionError: "친구 요청이 변경되었습니다. 최신 목록을 확인해 주세요.",
      });
      return false;
    }
    if (
      action.kind === "remove" &&
      !state.data.friends.some((entry) => entry.userId === action.userId)
    )
      return false;
    if (
      action.kind === "request" &&
      [...state.data.friends, ...state.data.outgoing].some(
        (entry) => entry.userId === action.userId,
      )
    )
      return false;
    const generation = epoch;
    const previousRead = flight;
    listVersion++;
    patch({
      pending: action,
      stale: true,
      onlineFresh: false,
      notice: null,
      actionError: null,
    });
    let success = false;
    try {
      // Discard an older read before issuing the write, so it cannot overwrite it.
      if (previousRead) await previousRead;
      if (!alive(generation)) return false;
      switch (action.kind) {
        case "request": {
          const result = await api.sendRequest(action.userId);
          if (alive(generation))
            patch({
              notice:
                result.status === "accepted"
                  ? "친구 요청을 수락했습니다."
                  : "친구 요청을 보냈습니다.",
            });
          break;
        }
        case "accept":
          await api.acceptRequest(action.requestId);
          break;
        case "decline":
          await api.declineRequest(action.requestId);
          break;
        case "remove":
          await api.removeFriend(action.userId);
          break;
      }
      if (!alive(generation)) return false;
      success = true;
      if (action.kind !== "request")
        patch({
          notice:
            action.kind === "accept"
              ? "친구 요청을 수락했습니다."
              : action.kind === "decline"
                ? "친구 요청을 거절했습니다."
                : "친구 관계를 삭제했습니다.",
        });
    } catch (error) {
      if (alive(generation))
        patch({ actionError: getFriendsErrorMessage(error) });
    } finally {
      if (alive(generation)) {
        await refresh(true);
        if (alive(generation)) patch({ pending: null });
      }
    }
    return success;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(connected: boolean, query = "") {
      active = true;
      epoch++;
      flight = null;
      dirty = false;
      state = initialState();
      patch({ connected, query });
      void refresh();
      if (query.trim()) void search();
    },
    stop() {
      active = false;
      epoch++;
      searchVersion++;
      listVersion++;
      flight = null;
      dirty = false;
      state = initialState();
    },
    setConnected(connected: boolean) {
      if (!active || connected === state.connected) return;
      patch({ connected, onlineFresh: false });
      if (connected) void refresh();
    },
    refresh: () => refresh(),
    setQuery,
    search,
    perform,
  };
}
