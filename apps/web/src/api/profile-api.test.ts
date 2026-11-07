import { describe, expect, it, vi } from "vitest";
import {
  createAuthApiClient,
  type StoredTokens,
  type TokenStorage,
} from "./auth-client.ts";
import { createProfileApi } from "./profile-api.ts";
import {
  avatarInitial,
  formatMatchDate,
  formatWinRate,
  sumStats,
  validateAvatarFile,
} from "./profile-format.ts";

function memoryStorage(initial: StoredTokens | null): TokenStorage {
  let current = initial;
  return {
    getTokens: () => current,
    setTokens: (tokens) => {
      current = { ...tokens };
    },
    clearTokens: () => {
      current = null;
    },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup() {
  const fetchMock = vi.fn<typeof fetch>();
  const client = createAuthApiClient({
    fetchImpl: fetchMock,
    storage: memoryStorage({ accessToken: "access", refreshToken: "refresh" }),
  });
  return { fetchMock, api: createProfileApi(client.request) };
}

describe("profile API client", () => {
  it("PATCH /api/users/me로 닉네임을 JSON 본문으로 변경한다", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json(200, { id: 1, nickname: "new", email: "a@b.c", avatarUrl: null }),
    );

    const user = await api.updateNickname("new");

    expect(user.nickname).toBe("new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/users/me");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ nickname: "new" }));
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer access");
  });

  it("PUT /api/users/me/avatar로 multipart `file`을 보내고 Content-Type을 직접 지정하지 않는다", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json(200, {
        id: 1,
        nickname: "n",
        email: "a@b.c",
        avatarUrl: "/api/media/avatars/x.png",
      }),
    );

    const file = new File([new Uint8Array([1, 2, 3])], "a.png", {
      type: "image/png",
    });
    const user = await api.uploadAvatar(file);

    expect(user.avatarUrl).toBe("/api/media/avatars/x.png");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/users/me/avatar");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("file")).toBeInstanceOf(File);
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("DELETE /api/users/me/avatar의 204 응답을 처리한다", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.deleteAvatar()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("통계·전적·리더보드·공개 프로필 요청 URL을 구성한다", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockImplementation(async () => json(200, []));

    await api.getProfile(7);
    await api.getStats(7, "gomoku");
    await api.getMatches(7, { gameType: "othello", before: 40, limit: 10 });
    await api.getMatches(7);
    await api.getLeaderboard("gomoku", 50);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/users/7",
      "/api/users/7/stats?gameType=gomoku",
      "/api/users/7/matches?gameType=othello&before=40&limit=10",
      "/api/users/7/matches",
      "/api/leaderboard?gameType=gomoku&limit=50",
    ]);
  });
});

describe("profile formatting helpers", () => {
  it("avatarUrl이 없을 때 쓰는 기본 이미지 글자를 만든다", () => {
    expect(avatarInitial("alex")).toBe("A");
    expect(avatarInitial("  바둑왕")).toBe("바");
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial(null)).toBe("?");
  });

  it("승률·날짜를 표시용으로 변환한다", () => {
    expect(formatWinRate(0)).toBe("0.0%");
    expect(formatWinRate(2 / 3)).toBe("66.7%");
    expect(formatMatchDate("not-a-date")).toBe("-");
    expect(formatMatchDate("2026-11-02T12:00:00.000Z")).toMatch(
      /^2026\.11\.0[23]$/,
    );
  });

  it("게임별 통계를 합산하고 played가 0이면 승률 0을 반환한다", () => {
    expect(sumStats([])).toMatchObject({ played: 0, winRate: 0 });
    expect(
      sumStats([
        { wins: 2, losses: 1, draws: 0 },
        { wins: 1, losses: 0, draws: 0 },
      ]),
    ).toMatchObject({ wins: 3, losses: 1, played: 4, winRate: 0.75 });
  });

  it("아바타 파일 형식과 크기를 사전 검증한다", () => {
    expect(validateAvatarFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(validateAvatarFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateAvatarFile({ type: "image/gif", size: 1000 })).toMatch(
      /PNG 또는 JPEG/,
    );
    expect(
      validateAvatarFile({ type: "image/png", size: 2 * 1024 * 1024 + 1 }),
    ).toMatch(/2MB/);
  });
});
