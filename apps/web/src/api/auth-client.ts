import { ApiError, isServerErrorPayload, isTransientError } from "./errors.ts";

export interface AuthUser {
  id: number;
  email: string;
  nickname: string;
  avatarUrl: string | null;
  recordsPublic: boolean;
  createdAt: string;
  /** 내 계정 조회 응답의 비밀번호 보유 여부입니다. 이전 서버 응답에는 없을 수 있습니다. */
  hasPassword?: boolean;
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

export interface OAuthAuthorizeResponse {
  authorizeUrl: string;
  flowToken: string;
}

export interface OAuthLinkedResult {
  linked: true;
}

export type OAuthCallbackResult = LoginResult | OAuthLinkedResult;

export interface TwoFactorStatusResponse {
  enabled: boolean;
}

export interface TwoFactorSetupResponse {
  secret: string;
  otpauthUrl: string;
}

export interface TwoFactorEnableResponse {
  recoveryCodes: string[];
}

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

/**
 * 회원 탈퇴 본인 확인 입력 (`DELETE /api/users/me`).
 *
 * 비밀번호 계정은 `password`, 비밀번호가 없는 42 OAuth 계정은 2FA `code`(복구 코드 포함)를 보냅니다.
 * 둘 다 없으면 서버가 10분 안의 로그인 여부로 확인합니다.
 */
export interface DeleteAccountInput {
  password?: string;
  code?: string;
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
export const OAUTH_FLOW_TOKEN_KEY = "cyber_board_cafe.oauth42.flow_token";

/**
 * 42 OAuth 인가 시작 시 발급받은 `flowToken`을 현재 브라우저 탭의 `sessionStorage`에 저장합니다 (RFC 9700 4.7.1 로그인 CSRF 방지).
 */
export function saveOAuthFlowToken(flowToken: string): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    globalThis.window.sessionStorage?.setItem(OAUTH_FLOW_TOKEN_KEY, flowToken);
  } catch {
    // sessionStorage 접근 제한 무시
  }
}

/**
 * `sessionStorage`에 보관된 42 OAuth `flowToken`을 조회합니다.
 */
export function getOAuthFlowToken(): string | null {
  if (typeof globalThis.window === "undefined") return null;
  try {
    return (
      globalThis.window.sessionStorage?.getItem(OAUTH_FLOW_TOKEN_KEY) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * `sessionStorage`에 보관된 42 OAuth `flowToken`을 제거합니다.
 */
export function clearOAuthFlowToken(): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    globalThis.window.sessionStorage?.removeItem(OAUTH_FLOW_TOKEN_KEY);
  } catch {
    // sessionStorage 접근 제한 무시
  }
}

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
    getSessionId() {
      if (getTokens()) return sessionId;
      try {
        // 익명 요청도 다른 탭의 새 로그인을 감지하며 그 토큰을 채택하지 않습니다.
        return (
          browserStorage("sessionStorage")?.getItem(SESSION_STORAGE_KEY) ||
          browserStorage("localStorage")?.getItem(SESSION_STORAGE_KEY) ||
          null
        );
      } catch {
        return null;
      }
    },
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
  /** 개별 요청과 재시도를 취소하며, 다른 요청과 공유하는 refresh는 취소하지 않습니다. */
  signal?: AbortSignal;
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
 * 로그인·OAuth 콜백 응답이 즉시 발급된 토큰 쌍(`TokenPair`)인지 판별합니다.
 */
export function isTokenPair(
  result: LoginResult | OAuthCallbackResult,
): result is TokenPair {
  return "accessToken" in result && typeof result.accessToken === "string";
}

/**
 * OAuth 콜백 응답이 기존 계정에 42 계정을 연결 완료한 결과(`{ linked: true }`)인지 판별합니다.
 */
export function isOAuthLinkedResult(
  result: OAuthCallbackResult,
): result is OAuthLinkedResult {
  return "linked" in result && result.linked === true;
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
  let loginAttempt = 0;
  let inFlightOAuth: {
    code: string;
    state: string;
    flowToken: string;
    result: Promise<OAuthCallbackResult>;
  } | null = null;

  function beginLoginAttempt() {
    const attempt = ++loginAttempt;
    const tokens = storage.getTokens();
    const sessionId = storage.getSessionId?.();
    return () => {
      const sameSession = storage.getSessionId
        ? storage.getSessionId() === sessionId
        : storage.getTokens()?.refreshToken === tokens?.refreshToken;
      if (attempt !== loginAttempt || !sameSession) {
        throw new ApiError(401, "UNAUTHENTICATED", "Login session changed.");
      }
    };
  }

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
        // 429·5xx는 토큰이 회전되지 않았으므로 저장된 토큰을 남겨 둡니다.
        if (
          !isTransientError(error) &&
          (isCurrentSession() || !storage.getTokens())
        ) {
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
   * @remarks signal 취소는 개별 요청·재시도에만 적용하며 공유 refresh는 완료될 수 있습니다.
   */
  async function request<T>(
    path: string,
    reqOptions: RequestOptions = {},
    hasRetried = false,
  ): Promise<T> {
    reqOptions.signal?.throwIfAborted();
    const method = reqOptions.method ?? "GET";
    const requiresAuth = reqOptions.requiresAuth ?? true;
    const sessionId = requiresAuth ? storage.getSessionId?.() : undefined;
    const assertCurrentSession = (accountDeleted = false) => {
      if (
        requiresAuth &&
        storage.getSessionId &&
        storage.getSessionId() !== sessionId &&
        !(accountDeleted && !storage.getTokens())
      ) {
        throw new ApiError(401, "UNAUTHENTICATED", "Login session changed.");
      }
    };
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...reqOptions.headers,
    };

    // FormData는 브라우저가 multipart boundary를 포함한 Content-Type을 직접 설정해야 합니다.
    const isFormData =
      typeof FormData !== "undefined" && reqOptions.body instanceof FormData;
    if (reqOptions.body !== undefined && !isFormData) {
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

    reqOptions.signal?.throwIfAborted();
    const response = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      signal: reqOptions.signal,
      body: isFormData
        ? (reqOptions.body as FormData)
        : reqOptions.body !== undefined
          ? JSON.stringify(reqOptions.body)
          : undefined,
    });

    reqOptions.signal?.throwIfAborted();
    // 탈퇴 commit의 WS 세션 폐기가 HTTP 204보다 먼저 도착할 수 있습니다.
    const accountDeleted =
      path === "/api/users/me" &&
      method === "DELETE" &&
      response.status === 204;
    assertCurrentSession(accountDeleted);

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
    reqOptions.signal?.throwIfAborted();
    assertCurrentSession(accountDeleted);
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
    const assertCurrentLogin = beginLoginAttempt();
    const result = await request<LoginResult>("/api/auth/login", {
      method: "POST",
      body: input,
      requiresAuth: false,
    });
    assertCurrentLogin();

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
    const assertCurrentLogin = beginLoginAttempt();
    const tokens = await request<TokenPair>("/api/auth/2fa/verify", {
      method: "POST",
      body: input,
      requiresAuth: false,
    });
    assertCurrentLogin();
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
    loginAttempt++;
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

  /**
   * 회원 탈퇴를 요청합니다 (`DELETE /api/users/me`, 204).
   *
   * @param input - 본인 확인 값. 비밀번호 계정은 `password`, 비밀번호 없는 42 계정은 `code`, 둘 다 없으면 최근 로그인으로 확인합니다.
   * @throws ApiError 본인 확인 실패(400 `INVALID_CREDENTIALS`·`INVALID_TWO_FACTOR_CODE`), 최근 로그인 필요(403 `RECENT_LOGIN_REQUIRED`), 진행 중 경기(409 `ACTIVE_MATCH`) 등
   * @remarks
   * 성공하면 서버가 이 계정의 모든 세션과 refresh token을 이미 폐기했으므로 `logout`을 호출하지 않고
   * 이 브라우저의 토큰만 지웁니다. 실패하면 토큰과 세션은 그대로 유지됩니다.
   * 본인 확인 실패는 401이 아닌 400이라 refresh·로그아웃으로 이어지지 않습니다.
   */
  async function deleteAccount(input: DeleteAccountInput = {}): Promise<void> {
    const sessionId = storage.getSessionId?.();
    const body: DeleteAccountInput = {};
    if (input.password !== undefined) body.password = input.password;
    if (input.code !== undefined) body.code = input.code;
    await request<void>("/api/users/me", {
      method: "DELETE",
      body: Object.keys(body).length > 0 ? body : undefined,
      requiresAuth: true,
    });
    loginAttempt++;
    if (
      !storage.getSessionId ||
      storage.getSessionId() === sessionId ||
      !storage.getTokens()
    ) {
      storage.clearTokens();
    }
  }

  /**
   * 42 Intra OAuth 로그인을 시작합니다 (`POST /api/auth/oauth/42/login`).
   * 반환된 `flowToken`은 브라우저 `sessionStorage`에 자동 보관됩니다.
   */
  async function startOAuth42Login(): Promise<OAuthAuthorizeResponse> {
    const assertCurrentLogin = beginLoginAttempt();
    const res = await request<OAuthAuthorizeResponse>(
      "/api/auth/oauth/42/login",
      {
        method: "POST",
        requiresAuth: false,
      },
    );
    assertCurrentLogin();
    saveOAuthFlowToken(res.flowToken);
    return res;
  }

  /**
   * 현재 로그인된 계정에 42 Intra 계정 연결을 시작합니다 (`POST /api/auth/oauth/42/link`).
   * 반환된 `flowToken`은 브라우저 `sessionStorage`에 자동 보관됩니다.
   */
  async function startOAuth42Link(): Promise<OAuthAuthorizeResponse> {
    const assertCurrentLogin = beginLoginAttempt();
    const res = await request<OAuthAuthorizeResponse>(
      "/api/auth/oauth/42/link",
      {
        method: "POST",
        requiresAuth: true,
      },
    );
    assertCurrentLogin();
    saveOAuthFlowToken(res.flowToken);
    return res;
  }

  /**
   * 42 OAuth 리다이렉트 콜백(`code`, `state`, `flowToken`)을 서버로 전달하여 로그인·2FA 챌린지·계정 연결을 완료합니다 (`POST /api/auth/oauth/42/callback`).
   * @throws ApiError flowToken이 없거나 서버가 거절하거나 대기 중 로그인 상태가 바뀐 경우
   * @throws TypeError 네트워크 요청에 실패한 경우
   * @remarks 동일한 콜백의 동시 호출은 첫 호출의 로그인 유지 선택으로 일회용 state를 한 번만 전송합니다.
   */
  async function completeOAuth42Callback(
    input: { code: string; state: string; flowToken?: string | null },
    remember = true,
  ): Promise<OAuthCallbackResult> {
    const resolvedFlowToken = input.flowToken ?? getOAuthFlowToken();
    if (!resolvedFlowToken) {
      throw new ApiError(
        401,
        "OAUTH_STATE_INVALID",
        "OAuth flowToken is missing from this browser session.",
      );
    }

    if (
      inFlightOAuth?.code === input.code &&
      inFlightOAuth.state === input.state &&
      inFlightOAuth.flowToken === resolvedFlowToken
    ) {
      return inFlightOAuth.result;
    }
    const assertCurrentLogin = beginLoginAttempt();
    const complete = async () => {
      try {
        const result = await request<OAuthCallbackResult>(
          "/api/auth/oauth/42/callback",
          {
            method: "POST",
            body: {
              code: input.code,
              state: input.state,
              flowToken: resolvedFlowToken,
            },
            requiresAuth: false,
          },
        );

        assertCurrentLogin();
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
      } finally {
        if (getOAuthFlowToken() === resolvedFlowToken) clearOAuthFlowToken();
      }
    };
    const result = complete();
    inFlightOAuth = {
      code: input.code,
      state: input.state,
      flowToken: resolvedFlowToken,
      result,
    };
    try {
      return await result;
    } finally {
      if (inFlightOAuth?.result === result) inFlightOAuth = null;
    }
  }

  /**
   * 현재 로그인된 계정의 TOTP 2단계 인증(2FA) 활성화 여부를 조회합니다 (`GET /api/auth/2fa`).
   */
  async function getTwoFactorStatus(): Promise<TwoFactorStatusResponse> {
    return request<TwoFactorStatusResponse>("/api/auth/2fa", {
      method: "GET",
      requiresAuth: true,
    });
  }

  /**
   * TOTP 2단계 인증 설정을 시작하고 시크릿(Base32) 및 `otpauth://` URL을 발급받습니다 (`POST /api/auth/2fa/setup`).
   */
  async function setupTwoFactor(): Promise<TwoFactorSetupResponse> {
    return request<TwoFactorSetupResponse>("/api/auth/2fa/setup", {
      method: "POST",
      requiresAuth: true,
    });
  }

  /**
   * 인증 앱의 6자리 TOTP 코드를 검증하여 2FA를 활성화하고 1회용 복구 코드 10개를 발급받습니다 (`POST /api/auth/2fa/enable`).
   */
  async function enableTwoFactor(
    code: string,
  ): Promise<TwoFactorEnableResponse> {
    return request<TwoFactorEnableResponse>("/api/auth/2fa/enable", {
      method: "POST",
      body: { code: code.trim() },
      requiresAuth: true,
    });
  }

  /**
   * 현재 6자리 TOTP 코드 또는 복구 코드로 본인 확인 후 2FA를 비활성화합니다 (`POST /api/auth/2fa/disable`).
   */
  async function disableTwoFactor(code: string): Promise<void> {
    return request<void>("/api/auth/2fa/disable", {
      method: "POST",
      body: { code: code.trim() },
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
    deleteAccount,
    startOAuth42Login,
    startOAuth42Link,
    completeOAuth42Callback,
    getTwoFactorStatus,
    setupTwoFactor,
    enableTwoFactor,
    disableTwoFactor,
  };
}

export type AuthApiClient = ReturnType<typeof createAuthApiClient>;

let authFailureHandler: (() => void) | undefined;

/**
 * 기본 {@link authApi}가 세션을 잃었을 때(refresh 거절, refresh 뒤에도 401) 부를 함수를 정합니다.
 *
 * @remarks 화면은 이것으로 로그인 화면으로 돌아갑니다. 429·5xx·네트워크 실패는 세션이 남아 있으므로 부르지 않습니다.
 */
export function setAuthFailureHandler(handler: (() => void) | undefined) {
  authFailureHandler = handler;
}

export const authApi = createAuthApiClient({
  onAuthFailure: () => authFailureHandler?.(),
});
