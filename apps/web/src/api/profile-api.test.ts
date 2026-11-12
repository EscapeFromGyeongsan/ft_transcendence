import { describe, expect, it, vi } from "vitest";
import {
  createAuthApiClient,
  type StoredTokens,
  type TokenStorage,
} from "./auth-client.ts";
import { createProfileApi } from "./profile-api.ts";
import {
  ApiError,
  getAccountDeletionErrorMessage,
  getErrorMessage,
} from "./errors.ts";
import {
  avatarInitial,
  formatMatchDate,
  formatOpponentName,
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
  it("recordsPublic false를 JSON으로 보내고 서버가 확인한 값을 돌려준다", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json(200, { id: 1, nickname: "owner", recordsPublic: false }),
    );
    expect((await api.updateRecordsPublic(false)).recordsPublic).toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/users/me");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ recordsPublic: false }));
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer access",
    );
  });

  it("설정이 누락되거나 무시된 성공 응답을 저장 완료로 처리하지 않는다", async () => {
    const { fetchMock, api } = setup();
    for (const recordsPublic of [undefined, true, "false"]) {
      fetchMock.mockResolvedValueOnce(json(200, { id: 1, recordsPublic }));
      await expect(api.updateRecordsPublic(false)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    }
  });

  it("비공개 전적 오류 코드를 보존하고 한국어 안내로 변환한다", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockResolvedValueOnce(
      json(403, { error: { code: "RECORDS_PRIVATE", message: "Private" } }),
    );
    await expect(api.getStats(2, "gomoku")).rejects.toMatchObject({
      status: 403,
      code: "RECORDS_PRIVATE",
    });
    expect(
      getErrorMessage(new ApiError(403, "RECORDS_PRIVATE", "Private")),
    ).toBe("이 사용자의 전적은 비공개입니다.");
  });

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

  it("DELETE /api/users/me에 본인 확인 값을 JSON으로 보내고 204를 처리한다", async () => {
    const { fetchMock, api } = setup();
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 204 }),
    );

    await expect(
      api.deleteAccount({ password: " pass word ", code: "" }),
    ).resolves.toBeUndefined();
    await api.deleteAccount({ password: "", code: " 123456 " });
    await api.deleteAccount();

    const bodies = fetchMock.mock.calls.map(([, init]) => init?.body);
    expect(bodies).toEqual([
      JSON.stringify({ password: " pass word " }),
      JSON.stringify({ code: "123456" }),
      JSON.stringify({}),
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/users/me");
    expect(init?.method).toBe("DELETE");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer access");
  });

  it.each([
    [
      400,
      "INVALID_CREDENTIALS",
      "비밀번호가 맞지 않습니다. 다시 확인해 주세요.",
    ],
    [
      400,
      "INVALID_TWO_FACTOR_CODE",
      "2단계 인증 코드 또는 복구 코드가 맞지 않습니다. 다시 확인해 주세요.",
    ],
    [
      403,
      "RECENT_LOGIN_REQUIRED",
      "본인 확인을 위해 다시 로그인한 뒤 10분 안에 탈퇴를 진행해 주세요.",
    ],
    [
      409,
      "ACTIVE_MATCH",
      "진행 중이거나 대기 중인 경기가 있습니다. 경기를 끝낸 뒤 다시 시도해 주세요.",
    ],
    [429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."],
    [
      503,
      "SERVICE_UNAVAILABLE",
      "서버 또는 데이터베이스에 일시적으로 연결할 수 없습니다.",
    ],
  ])(
    "탈퇴 실패 %i %s를 보존하고 탈퇴 화면용 한국어 안내로 변환한다",
    async (status, code, message) => {
      const { fetchMock, api } = setup();
      fetchMock.mockResolvedValueOnce(
        json(status, { error: { code, message: "server" } }),
      );
      const error = await api.deleteAccount({ password: "x" }).catch((e) => e);
      expect(error).toMatchObject({ status, code });
      expect(getAccountDeletionErrorMessage(error)).toBe(message);
    },
  );

  it("탈퇴 요청이 refresh 후에도 401이면 로컬 토큰을 지운다", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const storage = memoryStorage({
      accessToken: "access",
      refreshToken: "refresh",
    });
    const client = createAuthApiClient({ fetchImpl: fetchMock, storage });
    const api = createProfileApi(client.request);
    const unauthenticated = () =>
      json(401, { error: { code: "UNAUTHENTICATED", message: "x" } });
    fetchMock
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(
        json(200, {
          accessToken: "access2",
          tokenType: "Bearer",
          expiresIn: 1800,
          refreshToken: "refresh2",
        }),
      )
      .mockResolvedValueOnce(unauthenticated());

    const error = await api.deleteAccount({ password: "x" }).catch((e) => e);

    expect(error).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(storage.getTokens()).toBeNull();
    expect(getAccountDeletionErrorMessage(error)).toBe(
      "로그인이 필요하거나 세션이 만료되었습니다. 다시 로그인해 주세요.",
    );
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

  it("탈퇴한 상대는 경기 당시 닉네임 뒤에 (탈퇴한 사용자)를 붙인다", () => {
    expect(formatOpponentName({ nickname: "alex", deleted: false })).toBe(
      "alex",
    );
    expect(formatOpponentName({ nickname: "alex", deleted: true })).toBe(
      "alex (탈퇴한 사용자)",
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
