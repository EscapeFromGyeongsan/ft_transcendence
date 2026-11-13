import { describe, expect, it, vi } from "vitest";
import {
  createAuthApiClient,
  type StoredTokens,
  type TokenStorage,
} from "./auth-client.ts";
import { ApiError } from "./errors.ts";

function createMemoryTokenStorage(
  initial: StoredTokens | null = null,
): TokenStorage & { clearCalls: number } {
  let current = initial;
  const storage = {
    clearCalls: 0,
    getTokens: () => current,
    setTokens: (tokens: StoredTokens) => {
      current = { ...tokens };
    },
    clearTokens: () => {
      storage.clearCalls += 1;
      current = null;
    },
  };
  return storage;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: { code, message: `${code} message` } });
}

const SIGNED_IN: StoredTokens = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
};

describe("authApi.deleteAccount (DELETE /api/users/me, #89)", () => {
  it("탈퇴 204보다 세션 폐기 WS의 refresh 401이 먼저 와도 성공을 유지한다", async () => {
    const storage = createMemoryTokenStorage(SIGNED_IN);
    storage.getSessionId = () => (storage.getTokens() ? "session-a" : null);
    let finishDelete!: (response: Response) => void;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishDelete = resolve;
        }),
      )
      .mockResolvedValueOnce(errorResponse(401, "UNAUTHENTICATED"));
    const client = createAuthApiClient({ fetchImpl: fetchMock, storage });
    const deletion = client.deleteAccount({ password: "Test-password-1" });
    await expect(client.refresh()).rejects.toMatchObject({ status: 401 });
    expect(storage.getTokens()).toBeNull();
    finishDelete(new Response(null, { status: 204 }));
    await expect(deletion).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/users/me",
      "/api/auth/refresh",
    ]);
  });

  it("늦은 탈퇴 204가 새 로그인 세션을 지우지 않는다", async () => {
    const storage = createMemoryTokenStorage(SIGNED_IN);
    storage.getSessionId = () => storage.getTokens()?.accessToken ?? null;
    let finishDelete!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    const client = createAuthApiClient({ fetchImpl: fetchMock, storage });
    const deletion = client.deleteAccount({ password: "Test-password-1" });
    const next = { accessToken: "other-access", refreshToken: "other-refresh" };
    storage.setTokens(next);
    finishDelete(new Response(null, { status: 204 }));
    await expect(deletion).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(storage.getTokens()).toEqual(next);
  });

  it("비밀번호를 본문에 담아 Bearer로 보내고 204면 토큰만 지운다 (logout 호출 없음)", async () => {
    const storage = createMemoryTokenStorage(SIGNED_IN);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createAuthApiClient({ fetchImpl: fetchMock, storage });

    await expect(
      client.deleteAccount({ password: "Test-password-1" }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/users/me");
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({
      password: "Test-password-1",
    });
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer access-1",
      "Content-Type": "application/json",
    });
    // 서버가 세션을 이미 폐기했으므로 /api/auth/logout은 호출하지 않는다.
    expect(
      fetchMock.mock.calls.some(([p]) => String(p).includes("logout")),
    ).toBe(false);
    expect(storage.getTokens()).toBeNull();
  });

  it("본인 확인 값이 없으면 본문 없이 보낸다 (최근 로그인 42 계정)", async () => {
    const storage = createMemoryTokenStorage(SIGNED_IN);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createAuthApiClient({ fetchImpl: fetchMock, storage });

    await client.deleteAccount();

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.body).toBeUndefined();
    expect(
      (init?.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
    expect(storage.getTokens()).toBeNull();
  });

  it("2FA 코드는 code 필드로만 보낸다", async () => {
    const storage = createMemoryTokenStorage(SIGNED_IN);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createAuthApiClient({ fetchImpl: fetchMock, storage });

    await client.deleteAccount({ code: "ABCD-EFGH" });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      code: "ABCD-EFGH",
    });
  });

  it.each([
    [400, "INVALID_CREDENTIALS"],
    [400, "INVALID_TWO_FACTOR_CODE"],
    [403, "RECENT_LOGIN_REQUIRED"],
    [409, "ACTIVE_MATCH"],
    [422, "VALIDATION_ERROR"],
    [429, "RATE_LIMITED"],
    [503, "SERVICE_UNAVAILABLE"],
  ])(
    "%i %s는 ApiError로 전달하고 토큰·세션은 유지한다 (refresh·로그아웃 없음)",
    async (status, code) => {
      const storage = createMemoryTokenStorage(SIGNED_IN);
      const onAuthFailure = vi.fn();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(errorResponse(status, code));
      const client = createAuthApiClient({
        fetchImpl: fetchMock,
        storage,
        onAuthFailure,
      });

      const error = await client
        .deleteAccount({ password: "wrong" })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, code });
      // 본인 확인 실패가 401이었다면 refresh 후 로그아웃됐을 것이다. 400/403/409는 세션을 건드리지 않는다.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onAuthFailure).not.toHaveBeenCalled();
      expect(storage.getTokens()).toEqual(SIGNED_IN);
      expect(storage.clearCalls).toBe(0);
    },
  );

  it("access token 만료(401)면 refresh 후 같은 본문으로 한 번 재시도하고 성공하면 토큰을 지운다", async () => {
    const storage = createMemoryTokenStorage(SIGNED_IN);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(401, "UNAUTHENTICATED"))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: "access-2",
          tokenType: "Bearer",
          expiresIn: 1800,
          refreshToken: "refresh-2",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createAuthApiClient({ fetchImpl: fetchMock, storage });

    await client.deleteAccount({ password: "Test-password-1" });

    expect(fetchMock.mock.calls.map(([p]) => String(p))).toEqual([
      "/api/users/me",
      "/api/auth/refresh",
      "/api/users/me",
    ]);
    const retry = fetchMock.mock.calls[2][1];
    expect(retry?.headers).toMatchObject({ Authorization: "Bearer access-2" });
    expect(JSON.parse(String(retry?.body))).toEqual({
      password: "Test-password-1",
    });
    expect(storage.getTokens()).toBeNull();
  });

  it("refresh까지 거절되면(세션 종료·이미 탈퇴) 401 ApiError로 끝나고 토큰이 지워진다", async () => {
    const storage = createMemoryTokenStorage(SIGNED_IN);
    const onAuthFailure = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(401, "UNAUTHENTICATED"))
      .mockResolvedValueOnce(errorResponse(401, "UNAUTHENTICATED"));
    const client = createAuthApiClient({
      fetchImpl: fetchMock,
      storage,
      onAuthFailure,
    });

    const error = await client
      .deleteAccount({ password: "x" })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 401 });
    expect(storage.getTokens()).toBeNull();
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("네트워크 오류는 ApiError가 아닌 예외로 전달하고 토큰은 유지한다", async () => {
    const storage = createMemoryTokenStorage(SIGNED_IN);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const client = createAuthApiClient({ fetchImpl: fetchMock, storage });

    const error = await client
      .deleteAccount({ password: "x" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(storage.getTokens()).toEqual(SIGNED_IN);
  });
});
