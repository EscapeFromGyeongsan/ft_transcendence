import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors.ts";
import type { FriendsApi, FriendsList } from "../api/friends-api.ts";
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

describe("friends screen request lifecycle", () => {
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
