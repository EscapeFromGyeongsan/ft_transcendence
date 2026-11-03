import { describe, expect, it, vi } from "vitest";
import {
  createAuthApiClient,
  type StoredTokens,
  type TokenStorage,
} from "./auth-client.ts";
import { ApiError, getAuthFieldErrors, getErrorMessage } from "./errors.ts";

function createMemoryTokenStorage(
  initial: StoredTokens | null = null,
): TokenStorage {
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("authApi client & 401 refresh retry", () => {
  it("POST /api/auth/register, /login, /refresh, /logout을 순서대로 연동한다", async () => {
    const storage = createMemoryTokenStorage();
    const fetchMock = vi.fn<typeof fetch>();

    // 1. register (201)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        id: 7,
        email: "player@cafe.kr",
        nickname: "바둑왕",
        avatarUrl: null,
        createdAt: "2026-10-28T12:00:00.000Z",
      }),
    );

    // 2. login (200)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: "access-1",
        tokenType: "Bearer",
        expiresIn: 1800,
        refreshToken: "refresh-1",
      }),
    );

    // 3. refresh (200)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: "access-2",
        tokenType: "Bearer",
        expiresIn: 1800,
        refreshToken: "refresh-2",
      }),
    );

    // 4. logout (204)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = createAuthApiClient({
      fetchImpl: fetchMock,
      storage,
    });

    const user = await client.register({
      email: "player@cafe.kr",
      password: "password123",
      nickname: "바둑왕",
    });
    expect(user.id).toBe(7);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "player@cafe.kr",
          password: "password123",
          nickname: "바둑왕",
        }),
      }),
    );

    const loginResult = await client.login({
      email: "player@cafe.kr",
      password: "password123",
    });
    expect(loginResult).toEqual({
      accessToken: "access-1",
      tokenType: "Bearer",
      expiresIn: 1800,
      refreshToken: "refresh-1",
    });
    expect(storage.getTokens()).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const refreshed = await client.refresh();
    expect(refreshed.accessToken).toBe("access-2");
    expect(storage.getTokens()).toEqual({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    await client.logout();
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-2",
        }),
      }),
    );
    expect(storage.getTokens()).toBeNull();
  });

  it("보호 요청에서 access token 만료(401) 시 /api/auth/refresh 후 정확히 1회 재시도한다", async () => {
    const storage = createMemoryTokenStorage({
      accessToken: "expired-access",
      refreshToken: "valid-refresh",
    });
    const fetchMock = vi.fn<typeof fetch>();

    // 첫 번째 GET /api/users/me -> 401 UNAUTHENTICATED
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      }),
    );

    // POST /api/auth/refresh -> 200 새 토큰 발급
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: "fresh-access",
        tokenType: "Bearer",
        expiresIn: 1800,
        refreshToken: "fresh-refresh",
      }),
    );

    // 재시도된 GET /api/users/me -> 200 성공
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 1,
        email: "user@cafe.kr",
        nickname: "오목고수",
        avatarUrl: null,
        createdAt: "2026-10-28T00:00:00.000Z",
      }),
    );

    const client = createAuthApiClient({
      fetchImpl: fetchMock,
      storage,
    });

    const me = await client.getMe();
    expect(me.nickname).toBe("오목고수");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 1차 호출: 만료된 토큰 사용
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/users/me");
    expect(
      (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer expired-access");

    // 2차 호출: refresh
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/refresh");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ refreshToken: "valid-refresh" }),
    );

    // 3차 호출(1회 재시도): 새 토큰 사용
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/users/me");
    expect(
      (fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer fresh-access");

    // 저장소에도 교체된 refreshToken까지 반영되어야 함
    expect(storage.getTokens()).toEqual({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
    });
  });

  it("refresh 후 1회 재시도한 요청도 401이면 추가 재시도 없이 토큰을 비우고 오류를 던진다", async () => {
    const onAuthFailure = vi.fn();
    const storage = createMemoryTokenStorage({
      accessToken: "expired-access",
      refreshToken: "valid-refresh",
    });
    const fetchMock = vi.fn<typeof fetch>();

    // 1차 요청: 401
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { code: "UNAUTHENTICATED", message: "Authentication required." },
      }),
    );
    // refresh: 200
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        accessToken: "still-bad-access",
        tokenType: "Bearer",
        expiresIn: 1800,
        refreshToken: "next-refresh",
      }),
    );
    // 1회 재시도 요청: 여전히 401
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { code: "UNAUTHENTICATED", message: "Session revoked." },
      }),
    );

    const client = createAuthApiClient({
      fetchImpl: fetchMock,
      storage,
      onAuthFailure,
    });

    await expect(client.getMe()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });

    // 원래 요청 1회 + refresh 1회 + 재시도 1회 = 총 3회만 호출되어야 함
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(storage.getTokens()).toBeNull();
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("로그인 자체의 401(INVALID_CREDENTIALS)에서는 refresh를 시도하지 않는다", async () => {
    const storage = createMemoryTokenStorage({
      accessToken: "old-access",
      refreshToken: "old-refresh",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(401, {
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect.",
        },
      }),
    );

    const client = createAuthApiClient({
      fetchImpl: fetchMock,
      storage,
    });

    await expect(
      client.login({ email: "user@cafe.kr", password: "wrong-password" }),
    ).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("error.code 기준 오류 메시지 처리", () => {
  it("서버 message 문구와 무관하게 error.code를 기준으로 한국어 안내 문구를 반환한다", () => {
    const emailTaken = new ApiError(
      409,
      "EMAIL_TAKEN",
      "Arbitrary server text that should not control branching",
    );
    expect(getErrorMessage(emailTaken)).toBe("이미 등록된 이메일입니다.");
    expect(getAuthFieldErrors(emailTaken)).toEqual({
      email: "이미 등록된 이메일입니다.",
    });

    const nicknameTaken = new ApiError(
      409,
      "NICKNAME_TAKEN",
      "Nickname is already taken.",
    );
    expect(getErrorMessage(nicknameTaken)).toBe("이미 사용 중인 닉네임입니다.");
    expect(getAuthFieldErrors(nicknameTaken)).toEqual({
      nickname: "이미 사용 중인 닉네임입니다.",
    });

    const invalidCreds = new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect.",
    );
    expect(getErrorMessage(invalidCreds)).toBe(
      "이메일 또는 비밀번호가 맞지 않습니다.",
    );
  });

  it("등록되지 않은 error.code는 서버의 표시용 message를 폴백으로 사용한다", () => {
    const unknownCodeError = new ApiError(
      418,
      "CUSTOM_FUTURE_CODE",
      "표시용 서버 메시지입니다.",
    );
    expect(getErrorMessage(unknownCodeError)).toBe("표시용 서버 메시지입니다.");
  });
});
