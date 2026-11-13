import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors.ts";
import {
  createFriendsApi,
  type FriendsApi,
  type FriendsList,
} from "../api/friends-api.ts";
import { createFriendsController } from "./friends-state.ts";

const person = { userId: 2, nickname: "player2", avatarUrl: null };
const request = {
  ...person,
  requestId: 18,
  createdAt: "2026-11-09T00:00:00.000Z",
};
const empty = (): FriendsList => ({ friends: [], incoming: [], outgoing: [] });
const incoming = (): FriendsList => ({ ...empty(), incoming: [request] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(data = incoming()) {
  const api = {
    getFriends: vi.fn<FriendsApi["getFriends"]>().mockResolvedValue(data),
    searchUsers: vi.fn<FriendsApi["searchUsers"]>().mockResolvedValue([]),
    sendRequest: vi
      .fn<FriendsApi["sendRequest"]>()
      .mockResolvedValue({ ...person, requestId: 18, status: "pending" }),
    acceptRequest: vi
      .fn<FriendsApi["acceptRequest"]>()
      .mockResolvedValue({ ...person, requestId: 18, status: "accepted" }),
    declineRequest: vi
      .fn<FriendsApi["declineRequest"]>()
      .mockResolvedValue(undefined),
    removeFriend: vi
      .fn<FriendsApi["removeFriend"]>()
      .mockResolvedValue(undefined),
  };
  const controller = createFriendsController(api, 1);
  const ready = () =>
    vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
  return { api, controller, ready };
}

afterEach(() => vi.useRealTimers());

describe("friends screen request lifecycle", () => {
  it("삭제 404와 요청 충돌 뒤 목록만 다시 읽고 변경 요청을 재전송하지 않는다", async () => {
    const { api, controller, ready } = setup({
      ...empty(),
      friends: [{ ...person, online: true }],
    });
    controller.start(true);
    await ready();
    api.removeFriend.mockRejectedValueOnce(
      new ApiError(404, "NOT_FOUND", "gone"),
    );
    api.getFriends.mockResolvedValueOnce(empty());
    expect(await controller.perform({ kind: "remove", userId: 2 })).toBe(false);
    expect(api.removeFriend).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      pending: null,
      data: empty(),
      stale: false,
      notice: null,
    });
    expect(controller.getSnapshot().actionError).toContain("찾을 수 없습니다");
    api.sendRequest.mockRejectedValueOnce(
      new ApiError(409, "FRIEND_REQUEST_CONFLICT", "conflict"),
    );
    expect(await controller.perform({ kind: "request", userId: 2 })).toBe(
      false,
    );
    expect(api.sendRequest).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().actionError).toContain("관계가 변경");
    expect(api.getFriends).toHaveBeenCalledTimes(3);
    controller.stop();
  });
  it("releases a stalled list and search so a fresh read can recover", async () => {
    vi.useFakeTimers();
    const request = vi.fn<Parameters<typeof createFriendsApi>[0]>();
    const stalledList = deferred<FriendsList>();
    const stalledSearch = deferred<(typeof person)[]>();
    request
      .mockReturnValueOnce(stalledList.promise)
      .mockReturnValueOnce(stalledSearch.promise);
    const controller = createFriendsController(
      createFriendsApi(request as Parameters<typeof createFriendsApi>[0]),
      1,
    );
    controller.start(true);
    controller.setQuery("player");
    const search = controller.search();
    await vi.advanceTimersByTimeAsync(15_000);
    await search;
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      searching: false,
      stale: true,
    });
    expect(controller.getSnapshot().listError).toContain("초과");
    expect(controller.getSnapshot().searchError).toContain("초과");
    stalledList.resolve(incoming());
    stalledSearch.reject(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().data).toBeNull();
    request.mockResolvedValueOnce(empty());
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      stale: false,
      data: empty(),
      listError: null,
    });
    controller.stop();
  });

  it("keeps a timed-out mutation unconfirmed and blocks writes until a successful list read", async () => {
    vi.useFakeTimers();
    const request = vi.fn<Parameters<typeof createFriendsApi>[0]>();
    const stalledWrite = deferred<void>();
    const stalledRead = deferred<FriendsList>();
    request
      .mockResolvedValueOnce(incoming())
      .mockReturnValueOnce(stalledWrite.promise)
      .mockReturnValueOnce(stalledRead.promise);
    const controller = createFriendsController(
      createFriendsApi(request as Parameters<typeof createFriendsApi>[0]),
      1,
    );
    controller.start(true);
    await vi.advanceTimersByTimeAsync(0);
    const action = { kind: "decline" as const, userId: 2, requestId: 18 };
    const done = controller.perform(action);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(controller.getSnapshot().pending).toEqual(action);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await done).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      pending: null,
      stale: true,
      notice: null,
    });
    expect(controller.getSnapshot().actionError).toContain("처리 결과");
    expect(controller.getSnapshot().listError).toContain("초과");
    expect(await controller.perform(action)).toBe(false);
    stalledWrite.resolve();
    stalledRead.resolve(empty());
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().data).toEqual(incoming());
    request.mockResolvedValueOnce(empty());
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      pending: null,
      loading: false,
      stale: false,
      data: empty(),
    });
    expect(
      request.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
    controller.stop();
  });

  it("distinguishes an unavailable API from a successful empty list", async () => {
    const { api, controller, ready } = setup(empty());
    api.getFriends.mockRejectedValueOnce(
      new ApiError(404, "NOT_FOUND", "not provided"),
    );
    controller.start(true);
    await ready();
    expect(controller.getSnapshot()).toMatchObject({
      data: null,
      stale: true,
      onlineFresh: false,
    });
    expect(controller.getSnapshot().listError).toBeTruthy();
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      data: empty(),
      stale: false,
      listError: null,
    });
    controller.stop();
  });

  it("coalesces invalidations during a read and discards the older snapshot", async () => {
    const { api, controller } = setup();
    const first = deferred<FriendsList>();
    const second = deferred<FriendsList>();
    api.getFriends
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    controller.start(true);
    const done = controller.refresh();
    void controller.refresh();
    void controller.refresh();
    expect(api.getFriends).toHaveBeenCalledTimes(1);
    first.resolve(incoming());
    await vi.waitFor(() => expect(api.getFriends).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().data).toBeNull();
    second.resolve(empty());
    await done;
    expect(controller.getSnapshot()).toMatchObject({
      data: empty(),
      loading: false,
      stale: false,
    });
    controller.stop();
  });

  it("reports a failed invalidated read and stops immediate retries", async () => {
    const { api, controller } = setup();
    const first = deferred<FriendsList>();
    api.getFriends.mockReturnValueOnce(first.promise);
    controller.start(true);
    const done = controller.refresh();
    first.reject(new Error("offline"));
    await done;
    expect(api.getFriends).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      data: null,
      stale: true,
      loading: false,
    });
    expect(controller.getSnapshot().listError).toContain("네트워크");
    controller.stop();
  });

  it("ignores older searches immediately when the query changes", async () => {
    const { api, controller, ready } = setup();
    controller.start(true);
    await ready();
    const old = deferred<(typeof person)[]>();
    api.searchUsers
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([{ ...person, userId: 3, nickname: "new" }]);
    controller.setQuery("old");
    const first = controller.search();
    controller.setQuery("new");
    await controller.search();
    old.resolve([person]);
    await first;
    expect(controller.getSnapshot().results).toEqual([
      { ...person, userId: 3, nickname: "new" },
    ]);
    controller.stop();
  });

  it("discards reads/searches/mutations after stop, including a StrictMode-style restart", async () => {
    const { api, controller, ready } = setup();
    const old = deferred<FriendsList>();
    const oldSearch = deferred<(typeof person)[]>();
    api.getFriends
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(empty());
    api.searchUsers.mockReturnValueOnce(oldSearch.promise);
    controller.start(true, "old");
    controller.stop();
    controller.start(false);
    await ready();
    old.resolve(incoming());
    oldSearch.resolve([person]);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({
      data: empty(),
      results: null,
      onlineFresh: false,
      query: "",
    });
    controller.stop();
  });

  it("blocks duplicate writes, keeps the request until acknowledgement and reloads afterward", async () => {
    const { api, controller, ready } = setup();
    controller.start(true);
    await ready();
    const write = deferred<Awaited<ReturnType<FriendsApi["acceptRequest"]>>>();
    api.acceptRequest.mockReturnValueOnce(write.promise);
    api.getFriends.mockResolvedValueOnce({
      ...empty(),
      friends: [{ ...person, online: true }],
    });
    const action = { kind: "accept" as const, userId: 2, requestId: 18 };
    const done = controller.perform(action);
    expect(await controller.perform(action)).toBe(false);
    expect(controller.getSnapshot().data?.incoming).toHaveLength(1);
    expect(api.acceptRequest).toHaveBeenCalledTimes(1);
    write.resolve({ ...person, requestId: 18, status: "accepted" });
    expect(await done).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      pending: null,
      notice: "친구 요청을 수락했습니다.",
      data: { incoming: [], friends: [{ ...person, online: true }] },
      onlineFresh: true,
    });
    controller.stop();
  });

  it("preserves mutation success if its reload fails and retries only the read", async () => {
    const { api, controller, ready } = setup();
    controller.start(true);
    await ready();
    api.getFriends.mockRejectedValueOnce(new Error("lost connection"));
    expect(
      await controller.perform({ kind: "decline", userId: 2, requestId: 18 }),
    ).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      notice: "친구 요청을 거절했습니다.",
      actionError: null,
      stale: true,
      onlineFresh: false,
      pending: null,
    });
    expect(controller.getSnapshot().listError).toBeTruthy();
    expect(
      await controller.perform({ kind: "decline", userId: 2, requestId: 18 }),
    ).toBe(false);
    await controller.refresh();
    expect(api.declineRequest).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("refuses an obsolete request ID before sending a mutation", async () => {
    const { api, controller, ready } = setup();
    controller.start(true);
    await ready();
    expect(
      await controller.perform({ kind: "accept", userId: 2, requestId: 17 }),
    ).toBe(false);
    expect(api.acceptRequest).not.toHaveBeenCalled();
    expect(controller.getSnapshot().actionError).toContain("변경");
    controller.stop();
  });

  it.each([404, 409])(
    "reconciles a stale request rejected with %s without replaying the write",
    async (status) => {
      const { api, controller, ready } = setup();
      controller.start(true);
      await ready();
      api.acceptRequest.mockRejectedValueOnce(
        new ApiError(status, "NOT_FOUND", "changed"),
      );
      api.getFriends.mockResolvedValueOnce(empty());
      expect(
        await controller.perform({ kind: "accept", userId: 2, requestId: 18 }),
      ).toBe(false);
      expect(api.acceptRequest).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot()).toMatchObject({
        data: empty(),
        pending: null,
        stale: false,
        notice: null,
      });
      expect(controller.getSnapshot().actionError).toBeTruthy();
      controller.stop();
    },
  );

  it("invalidates online state while disconnected and reloads after reconnecting", async () => {
    const { api, controller, ready } = setup({
      ...empty(),
      friends: [{ ...person, online: true }],
    });
    controller.start(true);
    await ready();
    controller.setConnected(false);
    expect(controller.getSnapshot().onlineFresh).toBe(false);
    controller.setConnected(true);
    await ready();
    expect(api.getFriends).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().onlineFresh).toBe(true);
    controller.stop();
  });

  it("does not apply a mutation result or initiate a read after the screen ends", async () => {
    const { api, controller, ready } = setup();
    controller.start(true);
    await ready();
    const write = deferred<void>();
    api.declineRequest.mockReturnValueOnce(write.promise);
    const done = controller.perform({
      kind: "decline",
      userId: 2,
      requestId: 18,
    });
    controller.stop();
    write.resolve();
    await done;
    expect(controller.getSnapshot()).toMatchObject({
      data: null,
      pending: null,
      notice: null,
    });
    expect(api.getFriends).toHaveBeenCalledTimes(1);
  });
});
