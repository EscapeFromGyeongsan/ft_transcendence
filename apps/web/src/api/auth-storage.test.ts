import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthApiClient,
  createBrowserTokenStorage,
} from "./auth-client.ts";

const REFRESH_KEY = "cbc.auth.refreshToken";
const LEGACY_KEY = "cyber_board_cafe.auth.tokens";
const SESSION_KEY = "cbc.auth.sessionId";
const tokens = { accessToken: "access-1", refreshToken: "refresh-1" };

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

function jsonResponse(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installWebLocks() {
  let tail = Promise.resolve();
  const request = vi.fn((_name: string, callback: () => Promise<unknown>) => {
    const result = tail.then(callback);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  });
  vi.stubGlobal("navigator", { locks: { request } });
  return request;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe("브라우저 토큰 보관 계약", () => {
  it.each([true, false])(
    "로그인 유지=%s일 때 refresh token만 보관하고 새로고침 후 복원한다",
    (persistent) => {
      const { localStorage, sessionStorage } = installBrowserStorage();
      const selected = persistent ? localStorage : sessionStorage;
      const other = persistent ? sessionStorage : localStorage;
      const storage = createBrowserTokenStorage();

      storage.setTokens(tokens, persistent);
      expect(storage.getTokens()).toEqual(tokens);
      expect(selected.getItem(REFRESH_KEY)).toBe(tokens.refreshToken);
      expect(selected.getItem(SESSION_KEY)).toBeTruthy();
      expect(selected.length).toBe(2);
      expect(other.length).toBe(0);

      const reloaded = createBrowserTokenStorage();
      expect(reloaded.getTokens()).toEqual({
        accessToken: null,
        refreshToken: tokens.refreshToken,
      });
      reloaded.setTokens({
        accessToken: "access-2",
        refreshToken: "refresh-2",
      });
      expect(selected.getItem(REFRESH_KEY)).toBe("refresh-2");
      expect(other.length).toBe(0);
      reloaded.clearTokens();
      expect(reloaded.getTokens()).toBeNull();
      expect(selected.length).toBe(0);
    },
  );

  it.each([true, false])(
    "기존 로그인 유지=%s의 refresh만 이전하고 저장된 access token은 삭제한다",
    (persistent) => {
      const { localStorage, sessionStorage } = installBrowserStorage();
      const selected = persistent ? localStorage : sessionStorage;
      selected.setItem(LEGACY_KEY, JSON.stringify(tokens));

      expect(createBrowserTokenStorage().getTokens()).toEqual({
        accessToken: null,
        refreshToken: tokens.refreshToken,
      });
      expect(selected.getItem(REFRESH_KEY)).toBe(tokens.refreshToken);
      expect(selected.getItem(LEGACY_KEY)).toBeNull();
    },
  );

  it("선택되지 않은 저장소와 잘못된 기존 토큰에서도 access token 흔적을 지운다", () => {
    const { localStorage, sessionStorage } = installBrowserStorage();
    sessionStorage.setItem(REFRESH_KEY, "session-refresh");
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ accessToken: "legacy-access" }),
    );
    const storage = createBrowserTokenStorage();
    expect(storage.getTokens()).toEqual({
      accessToken: null,
      refreshToken: "session-refresh",
    });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

    storage.setTokens(tokens, true);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem(REFRESH_KEY)).toBe(tokens.refreshToken);
    storage.clearTokens();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("브라우저 저장소 getter가 막혀 있어도 메모리 로그인과 로그아웃이 동작한다", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new DOMException("Denied", "SecurityError");
      },
      get sessionStorage() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    const storage = createBrowserTokenStorage();
    expect(storage.getTokens()).toBeNull();
    storage.setTokens(tokens);
    expect(storage.getTokens()).toEqual(tokens);
    storage.clearTokens();
    expect(storage.getTokens()).toBeNull();
  });

  it.each(["not-json", "null", '{"refreshToken":42}'])(
    "잘못된 기존 토큰 %s는 복원하지 않고 삭제한다",
    (legacy) => {
      const { localStorage } = installBrowserStorage();
      localStorage.setItem(LEGACY_KEY, legacy);
      expect(createBrowserTokenStorage().getTokens()).toBeNull();
      expect(localStorage.length).toBe(0);
    },
  );

  it("할당량 초과 시 오래된 토큰은 지우고 새 토큰은 메모리에서 유지한다", () => {
    const { localStorage } = installBrowserStorage();
    localStorage.setItem(LEGACY_KEY, JSON.stringify(tokens));
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    const storage = createBrowserTokenStorage();
    expect(storage.getTokens()).toEqual({
      accessToken: null,
      refreshToken: tokens.refreshToken,
    });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    storage.setTokens({ accessToken: "access-2", refreshToken: "refresh-2" });
    expect(storage.getTokens()?.refreshToken).toBe("refresh-2");
    expect(localStorage.length).toBe(0);
  });
});

describe("메모리 access token 복원", () => {
  it("복원 직후 보호 요청이 401이면 다시 갱신하지 않고 로그인을 종료한다", async () => {
    const { localStorage } = installBrowserStorage();
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, { ...tokens, tokenType: "Bearer", expiresIn: 1800 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(401, {
          error: { code: "UNAUTHENTICATED", message: "Revoked" },
        }),
      );
    const onAuthFailure = vi.fn();
    const client = createAuthApiClient({ fetchImpl: fetchMock, onAuthFailure });
    await expect(client.getMe()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
    expect(client.storage.getTokens()).toBeNull();
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("동시 보호 요청은 refresh 한 번을 공유한 뒤 새 access token으로 요청한다", async () => {
    const { localStorage } = installBrowserStorage();
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    const nextTokens = {
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      tokenType: "Bearer",
      expiresIn: 1800,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path, init) => {
        if (path === "/api/auth/refresh") return jsonResponse(200, nextTokens);
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer fresh-access",
        );
        return jsonResponse(200, { id: 1 });
      });
    const client = createAuthApiClient({ fetchImpl: fetchMock });
    await Promise.all([client.getMe(), client.getMe()]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/auth/refresh",
      "/api/users/me",
      "/api/users/me",
    ]);
    expect(localStorage.getItem(REFRESH_KEY)).toBe("fresh-refresh");
    expect(localStorage.getItem(SESSION_KEY)).toBeTruthy();
    expect(localStorage.length).toBe(2);
  });

  it("늦게 도착한 이전 access token의 401은 교체된 토큰을 사용하고 다시 refresh하지 않는다", async () => {
    installBrowserStorage();
    const storage = createBrowserTokenStorage();
    storage.setTokens(tokens);
    let finishFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      finishFirst = resolve;
    });
    const denied = () =>
      jsonResponse(401, {
        error: { code: "UNAUTHENTICATED", message: "Expired" },
      });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(denied())
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: "fresh-access",
          refreshToken: "fresh-refresh",
          tokenType: "Bearer",
          expiresIn: 1800,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));
    const client = createAuthApiClient({ storage, fetchImpl: fetchMock });
    const first = client.getMe();
    await client.getMe();
    finishFirst(denied());
    await first;
    expect(
      fetchMock.mock.calls.filter(([path]) => path === "/api/auth/refresh"),
    ).toHaveLength(1);
    expect(fetchMock.mock.calls[4]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fresh-access",
    });
  });

  it("복원 refresh가 거절되면 저장 토큰을 지우고 보호 요청을 보내지 않는다", async () => {
    const { localStorage } = installBrowserStorage();
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { code: "UNAUTHENTICATED", message: "Revoked" },
      }),
    );
    const onAuthFailure = vi.fn();
    const client = createAuthApiClient({
      fetchImpl: fetchMock,
      onAuthFailure,
    });
    await expect(client.getMe()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/refresh");
    expect(client.storage.getTokens()).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  // 오프라인 새로고침: 요청이 서버에 닿지 않았으므로 refresh token은 아직 유효합니다.
  it("복원 refresh가 네트워크 실패면 저장 토큰을 남기고 로그아웃 처리하지 않는다", async () => {
    const { localStorage } = installBrowserStorage();
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValueOnce(new TypeError("Network failure"));
    const onAuthFailure = vi.fn();
    const client = createAuthApiClient({
      fetchImpl: fetchMock,
      onAuthFailure,
    });
    await expect(client.getMe()).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/refresh");
    expect(client.storage.getTokens()?.refreshToken).toBe(tokens.refreshToken);
    expect(localStorage.getItem(REFRESH_KEY)).toBe(tokens.refreshToken);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });
});

describe("탭 간 refresh와 로그인 경계", () => {
  it.each([
    ["waiting", "login"],
    ["waiting", "logout"],
    ["response", "login"],
    ["response", "logout"],
  ])(
    "표식 없는 복원의 %s 중 %s도 이전 세션을 되살리지 않는다",
    async (stage, change) => {
      const { localStorage } = installBrowserStorage();
      const lockRequest = installWebLocks();
      localStorage.setItem(LEGACY_KEY, JSON.stringify(tokens));
      const held = deferred<void>();
      if (stage === "waiting") {
        void lockRequest("cbc.auth.refresh", () => held.promise);
      }
      const response = deferred<Response>();
      const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise);
      const client = createAuthApiClient({ fetchImpl: fetchMock });
      const pending = client.refresh();
      const rejected = expect(pending).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      if (stage === "response") {
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      }
      const other = createBrowserTokenStorage();
      if (change === "logout") other.clearTokens();
      else
        other.setTokens(
          { accessToken: "other-access", refreshToken: "other-refresh" },
          true,
        );
      held.resolve();
      response.resolve(
        jsonResponse(200, {
          accessToken: "late-access",
          refreshToken: "late-refresh",
          tokenType: "Bearer",
          expiresIn: 1800,
        }),
      );
      await rejected;
      expect(fetchMock).toHaveBeenCalledTimes(stage === "waiting" ? 0 : 1);
      expect(localStorage.getItem(REFRESH_KEY)).toBe(
        change === "logout" ? null : "other-refresh",
      );
      expect(client.storage.getTokens()).toBeNull();
    },
  );

  it("초기 복원 중 다른 탭이 회전시킨 최신 refresh를 잠금 안에서 사용한다", async () => {
    const { localStorage } = installBrowserStorage();
    installWebLocks();
    const first = createBrowserTokenStorage();
    first.setTokens(tokens, true);
    const second = createBrowserTokenStorage();
    const getItem = localStorage.getItem;
    let rotated = false;
    vi.spyOn(localStorage, "getItem").mockImplementation((key) => {
      const value = getItem(key);
      if (key === SESSION_KEY && !rotated) {
        rotated = true;
        first.setTokens({ accessToken: "access-2", refreshToken: "refresh-2" });
      }
      return value;
    });
    second.getTokens();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_path, init) => {
        expect(JSON.parse(String(init?.body)).refreshToken).toBe("refresh-2");
        return jsonResponse(200, {
          accessToken: "access-3",
          refreshToken: "refresh-3",
          tokenType: "Bearer",
          expiresIn: 1800,
        });
      });
    await createAuthApiClient({
      storage: second,
      fetchImpl: fetchMock,
    }).refresh();
    expect(first.getTokens()?.refreshToken).toBe("refresh-3");
  });

  it("표식 없는 기존 세션을 동시에 복원해도 두 탭이 같은 세션을 유지한다", async () => {
    const { localStorage } = installBrowserStorage();
    installWebLocks();
    localStorage.setItem(LEGACY_KEY, JSON.stringify(tokens));
    const first = createBrowserTokenStorage();
    const second = createBrowserTokenStorage();
    const getItem = localStorage.getItem;
    let restored = false;
    vi.spyOn(localStorage, "getItem").mockImplementation((key) => {
      const value = getItem(key);
      if (key === SESSION_KEY && value === null && !restored) {
        restored = true;
        second.getTokens();
      }
      return value;
    });
    first.getTokens();
    expect(second.getTokens()?.refreshToken).toBe(tokens.refreshToken);
    let version = 1;
    const received: string[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path, init) => {
        if (path !== "/api/auth/refresh") return jsonResponse(200, { id: 1 });
        received.push(JSON.parse(String(init?.body)).refreshToken);
        expect(received.at(-1)).toBe(`refresh-${version}`);
        version += 1;
        return jsonResponse(200, {
          accessToken: `access-${version}`,
          refreshToken: `refresh-${version}`,
          tokenType: "Bearer",
          expiresIn: 1800,
        });
      });
    const firstClient = createAuthApiClient({
      storage: first,
      fetchImpl: fetchMock,
    });
    const secondClient = createAuthApiClient({
      storage: second,
      fetchImpl: fetchMock,
    });
    await Promise.all([firstClient.getMe(), secondClient.getMe()]);
    expect(received).toEqual(["refresh-1", "refresh-2"]);
    expect(first.getTokens()?.refreshToken).toBe("refresh-3");
    expect(second.getTokens()?.refreshToken).toBe("refresh-3");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("기존 토큰의 이전도 refresh 잠금 안에서 수행한다", async () => {
    const { localStorage } = installBrowserStorage();
    const lockRequest = installWebLocks();
    const held = deferred<void>();
    void lockRequest("cbc.auth.refresh", () => held.promise);
    localStorage.setItem(LEGACY_KEY, JSON.stringify(tokens));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        accessToken: "access-2",
        refreshToken: "refresh-2",
        tokenType: "Bearer",
        expiresIn: 1800,
      }),
    );
    const client = createAuthApiClient({ fetchImpl: fetchMock });
    const pending = client.refresh();
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    held.resolve();
    await pending;
    expect(localStorage.getItem(REFRESH_KEY)).toBe("refresh-2");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("로그인 유지 해제 시 각 탭의 sessionStorage는 서로의 로그인과 로그아웃에 영향을 받지 않는다", () => {
    const localStorage = createWebStorage();
    const firstTab = { localStorage, sessionStorage: createWebStorage() };
    const secondTab = { localStorage, sessionStorage: createWebStorage() };
    vi.stubGlobal("window", firstTab);
    const first = createBrowserTokenStorage();
    first.setTokens(tokens, false);
    vi.stubGlobal("window", secondTab);
    const second = createBrowserTokenStorage();
    expect(second.getTokens()).toBeNull();
    second.setTokens(
      { accessToken: "other-access", refreshToken: "other-refresh" },
      false,
    );
    vi.stubGlobal("window", firstTab);
    expect(first.getTokens()).toEqual(tokens);
    first.clearTokens();
    vi.stubGlobal("window", secondTab);
    expect(second.getTokens()?.accessToken).toBe("other-access");
    expect(localStorage.length).toBe(0);
  });

  it("두 탭의 복원을 직렬화하고 앞선 탭의 다음 갱신도 최신 refresh를 쓴다", async () => {
    const { localStorage } = installBrowserStorage();
    const lockRequest = installWebLocks();
    createBrowserTokenStorage().setTokens(tokens, true);
    const firstStorage = createBrowserTokenStorage();
    const secondStorage = createBrowserTokenStorage();
    firstStorage.getTokens();
    secondStorage.getTokens();
    let version = 1;
    const received: string[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path, init) => {
        if (path !== "/api/auth/refresh") return jsonResponse(200, { id: 1 });
        const token = JSON.parse(String(init?.body)).refreshToken;
        received.push(token);
        if (token !== `refresh-${version}`) {
          return jsonResponse(401, {
            error: { code: "UNAUTHENTICATED", message: "Refresh reuse" },
          });
        }
        version += 1;
        return jsonResponse(200, {
          accessToken: `access-${version}`,
          refreshToken: `refresh-${version}`,
          tokenType: "Bearer",
          expiresIn: 1800,
        });
      });
    const first = createAuthApiClient({
      storage: firstStorage,
      fetchImpl: fetchMock,
    });
    const second = createAuthApiClient({
      storage: secondStorage,
      fetchImpl: fetchMock,
    });
    await Promise.all([first.getMe(), second.getMe()]);
    await first.refresh();
    expect(received).toEqual(["refresh-1", "refresh-2", "refresh-3"]);
    expect(lockRequest).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem(REFRESH_KEY)).toBe("refresh-4");
    expect(localStorage.getItem(SESSION_KEY)).toBeTruthy();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("잠금을 기다리는 동안 다른 탭에서 로그인하면 이전 refresh를 보내지 않는다", async () => {
    const { localStorage } = installBrowserStorage();
    const lockRequest = installWebLocks();
    createBrowserTokenStorage().setTokens(tokens, true);
    const held = deferred<void>();
    void lockRequest("cbc.auth.refresh", () => held.promise);
    const fetchMock = vi.fn<typeof fetch>();
    const client = createAuthApiClient({ fetchImpl: fetchMock });
    const pending = client.refresh();
    const rejected = expect(pending).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    createBrowserTokenStorage().setTokens(
      { accessToken: "other-access", refreshToken: "other-refresh" },
      true,
    );
    held.resolve();
    await rejected;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(REFRESH_KEY)).toBe("other-refresh");
    expect(client.storage.getTokens()).toBeNull();
  });

  it.each(["logout", "other-tab-login", "same-tab-login"])(
    "refresh 응답 대기 중 %s이면 이전 세션을 복구하거나 새 세션을 지우지 않는다",
    async (change) => {
      const { localStorage } = installBrowserStorage();
      installWebLocks();
      const storage = createBrowserTokenStorage();
      storage.setTokens(tokens, true);
      const response = deferred<Response>();
      const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise);
      const onAuthFailure = vi.fn();
      const client = createAuthApiClient({
        storage,
        fetchImpl: fetchMock,
        onAuthFailure,
      });
      const pending = client.refresh();
      const rejected = expect(pending).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const other =
        change === "same-tab-login" ? storage : createBrowserTokenStorage();
      if (change === "logout") other.clearTokens();
      else
        other.setTokens(
          { accessToken: "other-access", refreshToken: "other-refresh" },
          true,
        );
      response.resolve(
        jsonResponse(200, {
          accessToken: "late-access",
          refreshToken: "late-refresh",
          tokenType: "Bearer",
          expiresIn: 1800,
        }),
      );
      await rejected;
      expect(localStorage.getItem(REFRESH_KEY)).toBe(
        change === "logout" ? null : "other-refresh",
      );
      if (change === "same-tab-login") {
        expect(storage.getTokens()?.accessToken).toBe("other-access");
        expect(onAuthFailure).not.toHaveBeenCalled();
      } else expect(storage.getTokens()).toBeNull();
    },
  );

  it("이전 계정 요청의 늦은 401을 새 계정 권한으로 재전송하지 않는다", async () => {
    installBrowserStorage();
    installWebLocks();
    const storage = createBrowserTokenStorage();
    storage.setTokens(tokens, true);
    const response = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    const client = createAuthApiClient({ storage, fetchImpl: fetchMock });
    const pending = client.request("/api/users/me", {
      method: "PATCH",
      body: { nickname: "old-account-edit" },
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    storage.setTokens(
      { accessToken: "other-access", refreshToken: "other-refresh" },
      true,
    );
    response.resolve(
      jsonResponse(401, {
        error: { code: "UNAUTHENTICATED", message: "Expired" },
      }),
    );
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.getTokens()?.refreshToken).toBe("other-refresh");
  });

  it("로그아웃 응답 대기 중 같은 탭에서 새로 로그인해도 새 토큰을 지우지 않는다", async () => {
    const { localStorage } = installBrowserStorage();
    const storage = createBrowserTokenStorage();
    storage.setTokens(tokens, true);
    const response = deferred<Response>();
    const client = createAuthApiClient({
      storage,
      fetchImpl: vi.fn<typeof fetch>().mockReturnValue(response.promise),
    });
    const pending = client.logout();
    const rejected = expect(pending).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    storage.setTokens(
      { accessToken: "other-access", refreshToken: "other-refresh" },
      true,
    );
    response.resolve(new Response(null, { status: 204 }));
    await rejected;
    expect(storage.getTokens()?.accessToken).toBe("other-access");
    expect(localStorage.getItem(REFRESH_KEY)).toBe("other-refresh");
  });
});
