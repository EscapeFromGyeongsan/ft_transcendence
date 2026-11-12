import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthApiClient,
  createBrowserTokenStorage,
  getOAuthFlowToken,
  saveOAuthFlowToken,
} from "./auth-client.ts";

const REFRESH_KEY = "cbc.auth.refreshToken";
const SESSION_KEY = "cbc.auth.sessionId";
const callbackInput = { code: "code-1", state: "state-1", flowToken: "flow-1" };
const issuedTokens = {
  accessToken: "oauth-access",
  refreshToken: "oauth-refresh",
  tokenType: "Bearer",
  expiresIn: 1800,
};
const priorTokens = {
  accessToken: "prior-access",
  refreshToken: "prior-refresh",
};

function createWebStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function installBrowserStorage() {
  const localStorage = createWebStorage();
  const sessionStorage = createWebStorage();
  vi.stubGlobal("window", { localStorage, sessionStorage });
  return { localStorage, sessionStorage };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe("OAuth 콜백과 브라우저 인증 경계", () => {
  it.each(["login", "twoFactor", "oauth"])(
    "익명 %s 대기 중 다른 탭의 새 로그인을 덮지 않는다",
    async (method) => {
      const firstWindow = installBrowserStorage();
      const storage = createBrowserTokenStorage();
      const response = deferred<Response>();
      const client = createAuthApiClient({
        storage,
        fetchImpl: vi.fn<typeof fetch>().mockReturnValue(response.promise),
      });
      const pending = (
        method === "login"
          ? client.login({
              email: "old@example.test",
              password: "test-password",
            })
          : method === "twoFactor"
            ? client.verifyTwoFactorLogin({
                challengeToken: "old-challenge",
                code: "123456",
              })
            : client.completeOAuth42Callback(callbackInput)
      ).catch((error: unknown) => error);
      vi.stubGlobal("window", {
        localStorage: firstWindow.localStorage,
        sessionStorage: createWebStorage(),
      });
      const otherStorage = createBrowserTokenStorage();
      otherStorage.setTokens(priorTokens, true);
      vi.stubGlobal("window", firstWindow);
      response.resolve(jsonResponse(issuedTokens));

      expect(await pending).toMatchObject({
        status: 401,
        code: "UNAUTHENTICATED",
      });
      expect(storage.getTokens()).toBeNull();
      expect(firstWindow.localStorage.getItem(REFRESH_KEY)).toBe(
        priorTokens.refreshToken,
      );
      expect(otherStorage.getTokens()).toEqual(priorTokens);
    },
  );

  it.each([true, false])(
    "로그인 유지=%s인 OAuth 로그인은 refresh만 보관하고 새로고침 후 갱신한다",
    async (remember) => {
      const { localStorage, sessionStorage } = installBrowserStorage();
      const selected = remember ? localStorage : sessionStorage;
      const other = remember ? sessionStorage : localStorage;
      const storage = createBrowserTokenStorage();
      const user = { id: 7, nickname: "플레이어" };
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(issuedTokens))
        .mockResolvedValueOnce(
          jsonResponse({
            ...issuedTokens,
            accessToken: "restored-access",
            refreshToken: "rotated-refresh",
          }),
        )
        .mockResolvedValueOnce(jsonResponse(user));
      const client = createAuthApiClient({ storage, fetchImpl: fetchMock });

      await expect(
        client.completeOAuth42Callback(callbackInput, remember),
      ).resolves.toEqual(issuedTokens);
      expect(storage.getTokens()?.accessToken).toBe(issuedTokens.accessToken);
      expect(selected.getItem(REFRESH_KEY)).toBe(issuedTokens.refreshToken);
      expect(selected.getItem(SESSION_KEY)).toBeTruthy();
      expect(selected.length).toBe(2);
      expect(other.length).toBe(0);

      const reloaded = createBrowserTokenStorage();
      expect(reloaded.getTokens()).toEqual({
        accessToken: null,
        refreshToken: issuedTokens.refreshToken,
      });
      const restoredClient = createAuthApiClient({
        storage: reloaded,
        fetchImpl: fetchMock,
      });
      await expect(restoredClient.getMe()).resolves.toEqual(user);
      expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
        "/api/auth/oauth/42/callback",
        "/api/auth/refresh",
        "/api/users/me",
      ]);
      expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
        Authorization: "Bearer restored-access",
      });
      expect(selected.getItem(REFRESH_KEY)).toBe("rotated-refresh");
      expect(selected.length).toBe(2);
      expect(other.length).toBe(0);
    },
  );

  it.each([
    { linked: true },
    { twoFactorRequired: true, challengeToken: "challenge-1", expiresIn: 300 },
  ])("토큰쌍이 아닌 결과 %j는 기존 로그인을 덮지 않는다", async (result) => {
    installBrowserStorage();
    const storage = createBrowserTokenStorage();
    storage.setTokens(priorTokens, true);
    const sessionId = storage.getSessionId?.();
    const client = createAuthApiClient({
      storage,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(result)),
    });

    await expect(
      client.completeOAuth42Callback(callbackInput, false),
    ).resolves.toEqual(result);
    expect(storage.getTokens()).toEqual(priorTokens);
    expect(storage.getSessionId?.()).toBe(sessionId);
  });

  it("동일 콜백의 동시 호출은 일회용 state를 한 번만 전송한다", async () => {
    installBrowserStorage();
    const response = deferred<void>();
    const fetchMock = vi.fn<typeof fetch>(() =>
      response.promise.then(() => jsonResponse(issuedTokens)),
    );
    const client = createAuthApiClient({ fetchImpl: fetchMock });
    const first = client.completeOAuth42Callback(callbackInput);
    const second = client.completeOAuth42Callback(callbackInput);
    response.resolve();

    const results = await Promise.all([first, second]);
    expect(results).toEqual([issuedTokens, issuedTokens]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["login", "logout"])(
    "콜백 대기 중 %s 후 도착한 토큰 응답은 이전 세션을 되살리지 않는다",
    async (change) => {
      const { localStorage } = installBrowserStorage();
      const storage = createBrowserTokenStorage();
      storage.setTokens(priorTokens, true);
      const response = deferred<Response>();
      const nextTokens = {
        ...issuedTokens,
        accessToken: "new-access",
        refreshToken: "new-refresh",
      };
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockReturnValueOnce(response.promise)
        .mockResolvedValueOnce(
          change === "login"
            ? jsonResponse(nextTokens)
            : new Response(null, { status: 204 }),
        );
      const client = createAuthApiClient({ storage, fetchImpl: fetchMock });
      const pending = client
        .completeOAuth42Callback(callbackInput)
        .catch((error: unknown) => error);

      if (change === "login") {
        await client.login({
          email: "other@example.test",
          password: "test-password",
        });
      } else {
        await client.logout();
      }
      const expectedTokens = storage.getTokens();
      const expectedSession = storage.getSessionId?.();
      response.resolve(jsonResponse(issuedTokens));
      const error = await pending;

      expect(storage.getTokens()).toEqual(expectedTokens);
      expect(storage.getSessionId?.()).toBe(expectedSession);
      expect(localStorage.getItem(REFRESH_KEY)).toBe(
        change === "login" ? "new-refresh" : null,
      );
      expect(error).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    },
  );

  for (const method of ["login", "verifyTwoFactorLogin"] as const) {
    it.each(["login", "logout"])(
      `${method} 응답 대기 중 %s하면 늦은 응답으로 로그인이 바뀌지 않는다`,
      async (change) => {
        installBrowserStorage();
        const storage = createBrowserTokenStorage();
        const response = deferred<Response>();
        const nextTokens = {
          ...issuedTokens,
          accessToken: "new-access",
          refreshToken: "new-refresh",
        };
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockReturnValueOnce(response.promise)
          .mockResolvedValueOnce(jsonResponse(nextTokens));
        const client = createAuthApiClient({ storage, fetchImpl: fetchMock });
        const pending = (
          method === "login"
            ? client.login({
                email: "first@example.test",
                password: "first-password",
              })
            : client.verifyTwoFactorLogin({
                challengeToken: "challenge-1",
                code: "123456",
              })
        ).catch((error: unknown) => error);

        if (change === "login") {
          await client.login({
            email: "other@example.test",
            password: "other-password",
          });
        } else {
          await client.logout();
        }
        const expectedTokens = storage.getTokens();
        const expectedSession = storage.getSessionId?.();
        response.resolve(jsonResponse(issuedTokens));

        expect(await pending).toMatchObject({
          status: 401,
          code: "UNAUTHENTICATED",
        });
        expect(storage.getTokens()).toEqual(expectedTokens);
        expect(storage.getSessionId?.()).toBe(expectedSession);
        expect(fetchMock).toHaveBeenCalledTimes(change === "login" ? 2 : 1);
      },
    );
  }

  it("비로그인 상태의 OAuth 콜백 대기 중 로그아웃하면 늦은 응답으로 로그인되지 않는다", async () => {
    installBrowserStorage();
    const storage = createBrowserTokenStorage();
    const response = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    const client = createAuthApiClient({ storage, fetchImpl: fetchMock });
    const pending = client
      .completeOAuth42Callback(callbackInput)
      .catch((error: unknown) => error);

    await client.logout();
    response.resolve(jsonResponse(issuedTokens));

    expect(await pending).toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(storage.getTokens()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([200, 401])(
    "기존 콜백의 %s 응답은 새 OAuth 흐름의 flowToken을 지우지 않는다",
    async (status) => {
      installBrowserStorage();
      saveOAuthFlowToken("flow-1");
      const response = deferred<Response>();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockReturnValueOnce(response.promise)
        .mockResolvedValueOnce(
          jsonResponse({
            authorizeUrl: "https://example.test/authorize",
            flowToken: "flow-2",
          }),
        );
      const client = createAuthApiClient({ fetchImpl: fetchMock });
      const pending = client
        .completeOAuth42Callback({ code: "code-1", state: "state-1" })
        .catch((error: unknown) => error);
      await client.startOAuth42Login();
      response.resolve(
        jsonResponse(
          status === 200
            ? issuedTokens
            : {
                error: {
                  code: "OAUTH_STATE_INVALID",
                  message: "Expired flow.",
                },
              },
          status,
        ),
      );
      await pending;

      expect(getOAuthFlowToken()).toBe("flow-2");
    },
  );
});
