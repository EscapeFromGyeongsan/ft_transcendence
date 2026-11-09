import { describe, expect, it, vi } from "vitest";
import { createAuthApiClient } from "./auth-client.ts";
import { ApiError } from "./errors.ts";
import { createFriendsApi, getFriendsErrorMessage } from "./friends-api.ts";

const person = { userId: 9, nickname: "friend", avatarUrl: null };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function setup() {
  const fetchMock = vi.fn<typeof fetch>();
  const client = createAuthApiClient({
    fetchImpl: fetchMock,
    storage: {
      getTokens: () => ({ accessToken: "access", refreshToken: "refresh" }),
      setTokens: vi.fn(),
      clearTokens: vi.fn(),
    },
  });
  return { fetchMock, api: createFriendsApi(client.request) };
}

describe("friends draft REST client", () => {
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

  it("isolates the provisional public-profile search shape and encodes the query", async () => {
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

  it("maps rejection without suggesting temporary retry and hides unsupported route internals", async () => {
    expect(
      getFriendsErrorMessage(new ApiError(409, "REQUEST_DECLINED", "declined")),
    ).toBe("이 사용자에게는 친구 요청을 다시 보낼 수 없습니다.");
    expect(
      getFriendsErrorMessage(
        new ApiError(404, "NOT_FOUND", "Route GET:/api/friends not found"),
      ),
    ).not.toContain("/api/");
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: "REQUEST_DECLINED", message: "declined" } }, 409),
    );
    await expect(api.sendRequest(9)).rejects.toMatchObject({
      code: "REQUEST_DECLINED",
    });
  });
});
