import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthApiClient, type StoredTokens } from "./auth-client.ts";
import { ApiError } from "./errors.ts";
import { createFriendsApi, getFriendsErrorMessage } from "./friends-api.ts";

const person = { userId: 9, nickname: "friend", avatarUrl: null };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function setup(
  initialTokens: StoredTokens = {
    accessToken: "access",
    refreshToken: "refresh",
  },
) {
  const fetchMock = vi.fn<typeof fetch>();
  let tokens = initialTokens;
  const client = createAuthApiClient({
    fetchImpl: fetchMock,
    storage: {
      getTokens: () => tokens,
      setTokens: vi.fn((next) => {
        tokens = next;
      }),
      clearTokens: vi.fn(),
    },
  });
  return { fetchMock, client, api: createFriendsApi(client.request) };
}

afterEach(() => vi.useRealTimers());

describe("friends REST client", () => {
  it("validates list fields, preserves online false and excludes unexpected personal fields", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json({
        friends: [{ ...person, online: false, email: "private@example.test" }],
        incoming: [],
        outgoing: [],
      }),
    );
    expect(await api.getFriends()).toEqual({
      friends: [{ ...person, online: false }],
      incoming: [],
      outgoing: [],
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer access",
    });
  });

  it.each([
    {},
    [],
    { friends: [person], incoming: [], outgoing: [] },
    { friends: [{ ...person, online: "false" }], incoming: [], outgoing: [] },
    {
      friends: [],
      incoming: [
        { ...person, requestId: "12", createdAt: new Date().toISOString() },
      ],
      outgoing: [],
    },
  ])(
    "rejects malformed data rather than producing empty/offline state: %j",
    async (body) => {
      const { fetchMock, api } = setup();
      fetchMock.mockResolvedValueOnce(json(body));
      await expect(api.getFriends()).rejects.toMatchObject({
        code: "FRIENDS_INVALID_RESPONSE",
      });
    },
  );

  it("preserves explicitly unavailable online state without treating it as offline", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json({
        friends: [{ ...person, online: null }],
        incoming: [],
        outgoing: [],
      }),
    );
    expect((await api.getFriends()).friends).toEqual([
      { ...person, online: null },
    ]);
  });

  it("refreshes a friends 401 once and retries with the rotated access token", async () => {
    const { fetchMock, api } = setup();
    fetchMock
      .mockResolvedValueOnce(
        json({ error: { code: "UNAUTHENTICATED", message: "expired" } }, 401),
      )
      .mockResolvedValueOnce(
        json({ accessToken: "next-access", refreshToken: "next-refresh" }),
      )
      .mockResolvedValueOnce(json({ friends: [], incoming: [], outgoing: [] }));
    await expect(api.getFriends()).resolves.toEqual({
      friends: [],
      incoming: [],
      outgoing: [],
    });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/friends",
      "/api/auth/refresh",
      "/api/friends",
    ]);
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({
      Authorization: "Bearer next-access",
    });
    expect(fetchMock.mock.calls[2][1]?.signal).toBe(
      fetchMock.mock.calls[0][1]?.signal,
    );
  });

  it("returns a bounded timeout and aborts a stalled list without replaying it", async () => {
    vi.useFakeTimers();
    const { fetchMock, api } = setup();
    let complete!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const result = api.getFriends().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({ code: "FRIENDS_TIMEOUT" });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    complete(json({ friends: [], incoming: [], outgoing: [] }));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(
      json({ friends: [], incoming: [], outgoing: [] }),
    );
    await expect(api.getFriends()).resolves.toEqual({
      friends: [],
      incoming: [],
      outgoing: [],
    });
  });

  it.each(["restore", "401"])(
    "does not send a timed-out write after a shared %s refresh eventually finishes",
    async (phase) => {
      vi.useFakeTimers();
      const { fetchMock, api, client } = setup({
        accessToken: phase === "restore" ? null : "access",
        refreshToken: "refresh",
      });
      let finishRefresh!: (response: Response) => void;
      if (phase === "401")
        fetchMock.mockResolvedValueOnce(
          json({ error: { code: "UNAUTHENTICATED", message: "expired" } }, 401),
        );
      fetchMock
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finishRefresh = resolve;
          }),
        )
        .mockImplementation((_path, options) => {
          options?.signal?.throwIfAborted();
          throw new Error("aborted retry reached the network");
        });
      const result = api.declineRequest(41).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await result).toMatchObject({ code: "FRIENDS_TIMEOUT" });
      const sharedRefresh = client.refresh();
      finishRefresh(
        json({ accessToken: "next-access", refreshToken: "next-refresh" }),
      );
      await expect(sharedRefresh).resolves.toMatchObject({
        accessToken: "next-access",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(
        fetchMock.mock.calls.filter(
          ([path]) => path === "/api/friends/requests/41/decline",
        ),
      ).toHaveLength(phase === "restore" ? 0 : 1);
      expect(
        fetchMock.mock.calls.find(([path]) => path === "/api/auth/refresh")?.[1]
          ?.signal,
      ).toBeUndefined();
    },
  );

  it("preserves deletion 404 and request conflict errors without replaying writes", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: "NOT_FOUND", message: "gone" } }, 404),
    );
    await expect(api.removeFriend(9)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    fetchMock.mockResolvedValueOnce(
      json(
        { error: { code: "FRIEND_REQUEST_CONFLICT", message: "conflict" } },
        409,
      ),
    );
    const error = await api.sendRequest(9).catch((error: unknown) => error);
    expect(error).toMatchObject({
      status: 409,
      code: "FRIEND_REQUEST_CONFLICT",
    });
    expect(getFriendsErrorMessage(error)).toBe(
      "친구 관계가 변경되었습니다. 목록을 다시 확인해 주세요.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes the public-profile search shape and encodes the query", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json([{ id: 9, nickname: "friend", avatarUrl: null }]),
    );
    expect(await api.searchUsers(" 바둑_왕 ")).toEqual([person]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/users?${new URLSearchParams({ nickname: "바둑_왕" })}`,
    );
    fetchMock.mockResolvedValueOnce(json({ users: [] }));
    await expect(api.searchUsers("friend")).rejects.toMatchObject({
      code: "FRIENDS_INVALID_RESPONSE",
    });
  });

  it("uses request IDs for accept/decline and user IDs for creation/deletion; handles 204", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json({ ...person, requestId: 41, status: "pending" }, 201),
    );
    await api.sendRequest(9);
    fetchMock.mockResolvedValueOnce(
      json({ ...person, requestId: 41, status: "accepted" }),
    );
    await api.acceptRequest(41);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.declineRequest(42);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.removeFriend(9);
    expect(
      fetchMock.mock.calls.map(([path, options]) => [
        path,
        options?.method,
        options?.body,
      ]),
    ).toEqual([
      ["/api/friends/requests", "POST", JSON.stringify({ userId: 9 })],
      ["/api/friends/requests/41/accept", "POST", undefined],
      ["/api/friends/requests/42/decline", "POST", undefined],
      ["/api/friends/9", "DELETE", undefined],
    ]);
  });

  it("does not accept an unrelated or unconfirmed successful mutation response", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json({ ...person, userId: 8, requestId: 41, status: "pending" }),
    );
    await expect(api.sendRequest(9)).rejects.toMatchObject({
      code: "FRIENDS_INVALID_RESPONSE",
    });
    fetchMock.mockResolvedValueOnce(
      json({ ...person, requestId: 42, status: "accepted" }),
    );
    await expect(api.acceptRequest(41)).rejects.toMatchObject({
      code: "FRIENDS_INVALID_RESPONSE",
    });
  });

  it.each([403, 409])(
    "maps rejection status %i without suggesting temporary retry and hides unsupported route internals",
    async (status) => {
      expect(
        getFriendsErrorMessage(
          new ApiError(status, "REQUEST_DECLINED", "declined"),
        ),
      ).toBe("이 사용자에게는 친구 요청을 다시 보낼 수 없습니다.");
      expect(
        getFriendsErrorMessage(
          new ApiError(404, "NOT_FOUND", "Route GET:/api/friends not found"),
        ),
      ).not.toContain("/api/");
      const { fetchMock, api } = setup();
      fetchMock.mockResolvedValueOnce(
        json(
          { error: { code: "REQUEST_DECLINED", message: "declined" } },
          status,
        ),
      );
      await expect(api.sendRequest(9)).rejects.toMatchObject({
        code: "REQUEST_DECLINED",
      });
    },
  );
});
