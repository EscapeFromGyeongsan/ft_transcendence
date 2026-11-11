import { ApiError, isServerErrorPayload } from "./errors.ts";

export interface AuthUser {
  id: number;
  email: string;
  nickname: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
}

export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
}

export type LoginResult = TokenPair | TwoFactorChallenge;

export interface RegisterInput {
  email: string;
  password: string;
  nickname: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface VerifyTwoFactorInput {
  challengeToken: string;
  code: string;
}

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string;
}

export interface TokenStorage {
  getTokens(): StoredTokens | null;
  setTokens(tokens: StoredTokens, persistent?: boolean): void;
  clearTokens(): void;
  /** 브라우저 로그인 변경·로그아웃을 구별하는 비밀이 아닌 표식이며 토큰 갱신 중에는 유지됩니다. */
  getSessionId?(): string | null;
  /** refresh 잠금 안에서 이전 저장 형식의 토큰을 이전합니다. */
  prepareRefresh?(): void;
}

const REFRESH_STORAGE_KEY = "cbc.auth.refreshToken";
const LEGACY_STORAGE_KEY = "cyber_board_cafe.auth.tokens";
const SESSION_STORAGE_KEY = "cbc.auth.sessionId";

/**
 * access token은 메모리에만, refresh token은 로그인 유지 선택에 따라 브라우저 저장소에 보관합니다.
 * 저장소 접근이 차단되면 현재 페이지의 메모리만 사용합니다.
 */
export function createBrowserTokenStorage(): TokenStorage {
  let memoryTokens: StoredTokens | null = null;
  let usePersistent = true;
  let initialized = false;
  let sessionId: string | null = null;
  let persistedSessionId: string | null = null;
  let persisted = false;

  function browserStorage(name: "localStorage" | "sessionStorage") {
    try {
      return typeof window === "undefined" ? undefined : window[name];
    } catch {
      return undefined;
    }
  }

  function readRefreshToken(storage: Storage | undefined, migrate = true) {
    let refreshToken: string | null = null;
    let saved = false;
    try {
      refreshToken = storage?.getItem(REFRESH_STORAGE_KEY) || null;
      saved = !!refreshToken;
      const legacy = storage?.getItem(LEGACY_STORAGE_KEY);
      // 공유 저장소의 이전 작업도 refresh와 같은 잠금 안에서 수행합니다.
      if (migrate) storage?.removeItem(LEGACY_STORAGE_KEY);
      if (!refreshToken && legacy) {
        const parsed: unknown = JSON.parse(legacy);
        if (
          parsed &&
          typeof parsed === "object" &&
          "refreshToken" in parsed &&
          typeof parsed.refreshToken === "string" &&
          parsed.refreshToken.length > 0
        ) {
          refreshToken = parsed.refreshToken;
          if (migrate) storage?.setItem(REFRESH_STORAGE_KEY, refreshToken);
          saved = !!storage;
        }
      }
    } catch {
      // 저장에 실패해도 읽은 refresh token은 현재 페이지에서 사용할 수 있습니다.
    }
    return { refreshToken, saved };
  }

  function clearWebStorage(storage: Storage | undefined) {
    try {
      storage?.removeItem(REFRESH_STORAGE_KEY);
      storage?.removeItem(LEGACY_STORAGE_KEY);
      storage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // 접근이 차단된 저장소는 변경할 수 없습니다.
    }
  }

  function getTokens(): StoredTokens | null {
    if (!initialized) {
      initialized = true;
      const migrate = !(typeof navigator !== "undefined" && navigator.locks);
      const sessionToken = readRefreshToken(
        browserStorage("sessionStorage"),
        migrate,
      );
      const localToken = readRefreshToken(
        browserStorage("localStorage"),
        migrate,
      );
      const selectedToken = sessionToken.refreshToken
        ? sessionToken
        : localToken;
      const { refreshToken } = selectedToken;
      if (refreshToken) {
        usePersistent = !sessionToken.refreshToken;
        memoryTokens = { accessToken: null, refreshToken };
        persisted = selectedToken.saved;
        const selected = browserStorage(
          usePersistent ? "localStorage" : "sessionStorage",
        );
        sessionId = crypto.randomUUID();
        try {
          persistedSessionId = selected?.getItem(SESSION_STORAGE_KEY) || null;
        } catch {
          if (persisted) memoryTokens = null;
        }
      }
    }
    if (memoryTokens && persisted) {
      const selected = browserStorage(
        usePersistent ? "localStorage" : "sessionStorage",
      );
      try {
        const storedSessionId = selected?.getItem(SESSION_STORAGE_KEY) || null;
        const { refreshToken } = readRefreshToken(selected, false);
        if (
          !refreshToken ||
          (selected?.getItem(SESSION_STORAGE_KEY) || null) !==
            storedSessionId ||
          (storedSessionId !== persistedSessionId &&
            !(
              persistedSessionId === null &&
              storedSessionId?.startsWith("restored:")
            ))
        ) {
          memoryTokens = null;
        } else {
          persistedSessionId = storedSessionId;
          memoryTokens = { ...memoryTokens, refreshToken };
        }
      } catch {
        // 공유 토큰을 다시 읽을 수 없으면 오래된 일회용 토큰을 보내지 않습니다.
        memoryTokens = null;
      }
    }
    return memoryTokens;
  }

  return {
    getTokens,
    getSessionId: () => (getTokens() ? sessionId : null),
    prepareRefresh(): void {
      if (!getTokens() || !persisted) return;
      const selected = browserStorage(
        usePersistent ? "localStorage" : "sessionStorage",
      );
      const latest = readRefreshToken(selected);
      memoryTokens = latest.refreshToken
        ? { ...memoryTokens!, refreshToken: latest.refreshToken }
        : null;
      persisted = latest.saved;
      readRefreshToken(
        browserStorage(usePersistent ? "sessionStorage" : "localStorage"),
      );
    },
    setTokens(tokens: StoredTokens, persistent?: boolean): void {
      const newSession = typeof persistent === "boolean" || !sessionId;
      if (typeof persistent === "boolean") {
        usePersistent = persistent;
      }
      if (newSession) {
        sessionId = crypto.randomUUID();
        persistedSessionId = sessionId;
      } else {
        // 첫 복원 표식은 refresh 잠금 안에서 확정하며 대기 중인 복원 탭만 채택합니다.
        persistedSessionId ??= `restored:${sessionId}`;
      }
      initialized = true;
      memoryTokens = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
      const local = browserStorage("localStorage");
      const session = browserStorage("sessionStorage");
      if (newSession) {
        clearWebStorage(local);
        clearWebStorage(session);
      }
      const selected = usePersistent ? local : session;
      persisted = false;
      try {
        selected?.setItem(SESSION_STORAGE_KEY, persistedSessionId!);
        selected?.setItem(REFRESH_STORAGE_KEY, tokens.refreshToken);
        persisted = !!selected;
      } catch {
        clearWebStorage(selected);
        // 할당량·개인정보 설정으로 저장할 수 없으면 메모리만 사용합니다.
      }
    },

    clearTokens(): void {
      getTokens();
      memoryTokens = null;
      initialized = true;
      const selected = browserStorage(
        usePersistent ? "localStorage" : "sessionStorage",
      );
      try {
        if (
          persisted &&
          (selected?.getItem(SESSION_STORAGE_KEY) || null) ===
            persistedSessionId
        ) {
          clearWebStorage(selected);
        }
      } catch {
        // 다른 로그인이나 접근 불가 저장소는 지우지 않습니다.
      }
      sessionId = null;
      persistedSessionId = null;
      persisted = false;
    },
  };
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * `true`이면 `Authorization: Bearer <accessToken>` 헤더를 첨부하고,
   * 401 응답 시 `/api/auth/refresh` 호출 후 1회 재시도합니다. 기본값은 `true`입니다.
   */
  requiresAuth?: boolean;
}

export interface AuthApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  storage?: TokenStorage;
  onAuthFailure?: () => void;
}

/**
 * 로그인 응답이 즉시 발급된 토큰 쌍(`TokenPair`)인지 판별합니다.
 */
export function isTokenPair(result: LoginResult): result is TokenPair {
  return "accessToken" in result && typeof result.accessToken === "string";
}

/**
 * 인증 API(`register`, `login`, `logout`, `refresh`) 연동과
 * 보호 요청의 401 만료 시 자동 refresh 후 1회 재시도를 담당하는 클라이언트를 생성합니다.
 *
 * @param options - fetch 구현체, 토큰 저장소, 세션 만료 콜백 설정
 * @returns 인증 및 API 호출 메서드를 포함한 클라이언트 객체
 *
 * @remarks
 * 서버는 `/api/auth/refresh` 호출마다 기존 refresh token을 폐기하고 새 토큰 쌍을 발급합니다.
 * 이미 교체된 refresh token이 재전송되면 세션 전체가 폐기되므로, 동시에 발생한 401 응답들은
 * 단일 `inFlightRefresh` Promise를 공유해 중복 갱신을 방지합니다.
 */
export function createAuthApiClient(options: AuthApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const fetchFn: typeof fetch =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const storage = options.storage ?? createBrowserTokenStorage();
  let inFlightRefresh: Promise<TokenPair> | null = null;

  async function parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type") ?? "";
    let payload: unknown = undefined;

    if (contentType.includes("application/json")) {
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
    } else {
      const text = await response.text();
      if (text.trim().length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }
    }

    if (!response.ok) {
      if (isServerErrorPayload(payload)) {
        throw new ApiError(
          response.status,
          payload.error.code,
          payload.error.message,
          payload.error.details,
        );
      }
      throw new ApiError(
        response.status,
        response.status === 401 ? "UNAUTHENTICATED" : "INTERNAL_ERROR",
        typeof payload === "string" && payload.length > 0
          ? payload
          : `HTTP ${response.status}`,
      );
    }

    return payload as T;
  }

  /**
   * 보관된 `refreshToken`으로 `POST /api/auth/refresh`를 호출하여 토큰 쌍을 교체합니다.
   *
   * @param explicitRefreshToken - 직접 지정할 refresh token (생략 시 저장소의 토큰 사용)
   * @returns 새로 발급된 `TokenPair`
   * @throws ApiError refresh token이 없거나 서버가 401 등으로 거절한 경우
   * @throws TypeError 네트워크 요청에 실패한 경우
   */
  async function refresh(explicitRefreshToken?: string): Promise<TokenPair> {
    if (inFlightRefresh) {
      return inFlightRefresh;
    }

    const currentTokens = storage.getTokens();
    if (
      explicitRefreshToken &&
      currentTokens &&
      explicitRefreshToken !== currentTokens.refreshToken
    ) {
      throw new ApiError(
        401,
        "UNAUTHENTICATED",
        "Refresh token belongs to another session.",
      );
    }
    const sessionId = storage.getSessionId?.();
    const isCurrentSession = () =>
      storage.getSessionId
        ? storage.getSessionId() === sessionId
        : storage.getTokens()?.refreshToken === currentTokens?.refreshToken;

    const runRefresh = async (): Promise<TokenPair> => {
      try {
        if (!isCurrentSession()) {
          throw new ApiError(401, "UNAUTHENTICATED", "Login session changed.");
        }
        storage.prepareRefresh?.();
        if (!isCurrentSession()) {
          throw new ApiError(401, "UNAUTHENTICATED", "Login session changed.");
        }
        const latestTokens = storage.getTokens();
        const tokenToUse = latestTokens?.refreshToken ?? explicitRefreshToken;
        if (!tokenToUse) {
          throw new ApiError(
            401,
            "UNAUTHENTICATED",
            "Refresh token is missing.",
          );
        }
        const response = await fetchFn(`${baseUrl}/api/auth/refresh`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refreshToken: tokenToUse }),
        });
        const nextTokens = await parseResponse<TokenPair>(response);
        if (!isCurrentSession()) {
          throw new ApiError(401, "UNAUTHENTICATED", "Login session changed.");
        }
        storage.setTokens({
          accessToken: nextTokens.accessToken,
          refreshToken: nextTokens.refreshToken,
        });
        return nextTokens;
      } catch (error) {
        if (isCurrentSession() || !storage.getTokens()) {
          storage.clearTokens();
          options.onAuthFailure?.();
        }
        throw error;
      }
    };

    // 같은 origin의 탭이 일회용 refresh token을 동시에 소비하지 않게 합니다.
    // shortcut: Web Locks 미지원 환경은 같은 탭만 보호하며, 지원 환경 확대 시 탭 간 조정이 필요합니다.
    const result =
      typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request("cbc.auth.refresh", runRefresh)
        : runRefresh();
    inFlightRefresh = result;
    try {
      return await result;
    } finally {
      if (inFlightRefresh === result) inFlightRefresh = null;
    }
  }

  /**
   * 새로고침 후에는 refresh로 access token을 복원하고, 인증 요청의 401은 한 번만 재시도합니다.
   */
  async function request<T>(
    path: string,
    reqOptions: RequestOptions = {},
    hasRetried = false,
  ): Promise<T> {
    const method = reqOptions.method ?? "GET";
    const requiresAuth = reqOptions.requiresAuth ?? true;
    const sessionId = requiresAuth ? storage.getSessionId?.() : undefined;
    const assertCurrentSession = () => {
      if (
        requiresAuth &&
        storage.getSessionId &&
        storage.getSessionId() !== sessionId
      ) {
        throw new ApiError(401, "UNAUTHENTICATED", "Login session changed.");
      }
    };
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...reqOptions.headers,
    };

    if (reqOptions.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let accessToken: string | null = null;
    if (requiresAuth) {
      let tokens = storage.getTokens();
      if (!hasRetried && !tokens?.accessToken && tokens?.refreshToken) {
        await refresh();
        hasRetried = true;
        tokens = storage.getTokens();
      }
      assertCurrentSession();
      if (tokens?.accessToken) {
        accessToken = tokens.accessToken;
        headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
    }

    const response = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      body:
        reqOptions.body !== undefined
          ? JSON.stringify(reqOptions.body)
          : undefined,
    });

    assertCurrentSession();

    if (response.status === 401 && requiresAuth && !hasRetried) {
      const currentTokens = storage.getTokens();
      if (currentTokens?.refreshToken) {
        if (
          !currentTokens.accessToken ||
          currentTokens.accessToken === accessToken
        ) {
          await refresh();
        }
        assertCurrentSession();
        return request<T>(path, reqOptions, true);
      }
    }

    if (response.status === 401 && requiresAuth && hasRetried) {
      storage.clearTokens();
      options.onAuthFailure?.();
    }

    const payload = await parseResponse<T>(response);
    assertCurrentSession();
    return payload;
  }

  /**
   * 이메일·비밀번호·닉네임으로 신규 계정을 등록합니다 (`POST /api/auth/register`).
   */
  async function register(input: RegisterInput): Promise<AuthUser> {
    return request<AuthUser>("/api/auth/register", {
      method: "POST",
      body: input,
      requiresAuth: false,
    });
  }

  /**
   * 이메일과 비밀번호로 로그인하고 세션을 생성합니다 (`POST /api/auth/login`).
   *
   * @param input - 이메일과 비밀번호
   * @param remember - `true`면 `localStorage`, `false`면 `sessionStorage`에 refresh token만 보관
   * @returns 2FA 미사용 계정은 `TokenPair`, 2FA 활성 계정은 `TwoFactorChallenge`
   */
  async function login(
    input: LoginInput,
    remember = true,
  ): Promise<LoginResult> {
    const result = await request<LoginResult>("/api/auth/login", {
      method: "POST",
      body: input,
      requiresAuth: false,
    });

    if (isTokenPair(result)) {
      storage.setTokens(
        {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
        remember,
      );
    }

    return result;
  }

  /**
   * 2FA가 활성화된 계정의 2단계 로그인 코드를 검증하고 세션을 발급받습니다 (`POST /api/auth/2fa/verify`).
   */
  async function verifyTwoFactorLogin(
    input: VerifyTwoFactorInput,
    remember = true,
  ): Promise<TokenPair> {
    const tokens = await request<TokenPair>("/api/auth/2fa/verify", {
      method: "POST",
      body: input,
      requiresAuth: false,
    });
    storage.setTokens(
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      remember,
    );
    return tokens;
  }

  /**
   * 현재 세션을 서버에서 폐기하고 클라이언트에 보관된 토큰을 삭제합니다 (`POST /api/auth/logout`).
   *
   * @remarks
   * access token이 만료되어 401이 반환되더라도 `request()` 내부에서 자동으로
   * `/api/auth/refresh` 후 1회 재시도하여 서버 세션을 정상 폐기합니다.
   */
  async function logout(): Promise<void> {
    const sessionId = storage.getSessionId?.();
    try {
      const tokens = storage.getTokens();
      if (tokens?.accessToken || tokens?.refreshToken) {
        await request<void>("/api/auth/logout", {
          method: "POST",
          requiresAuth: true,
        });
      }
    } finally {
      if (
        !storage.getSessionId ||
        storage.getSessionId() === sessionId ||
        !storage.getTokens()
      ) {
        storage.clearTokens();
      }
    }
  }

  /**
   * 현재 로그인한 사용자의 계정 정보를 조회합니다 (`GET /api/users/me`).
   */
  async function getMe(): Promise<AuthUser> {
    return request<AuthUser>("/api/users/me", {
      method: "GET",
      requiresAuth: true,
    });
  }

  return {
    storage,
    request,
    register,
    login,
    verifyTwoFactorLogin,
    refresh,
    logout,
    getMe,
  };
}

export const authApi = createAuthApiClient();
