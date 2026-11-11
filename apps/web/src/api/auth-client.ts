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

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStorage {
  getTokens(): StoredTokens | null;
  setTokens(tokens: StoredTokens, persistent?: boolean): void;
  clearTokens(): void;
}

const STORAGE_KEY = "cyber_board_cafe.auth.tokens";
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
    return globalThis.window.sessionStorage?.getItem(OAUTH_FLOW_TOKEN_KEY) ?? null;
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
 * 브라우저 `localStorage`/`sessionStorage` 및 메모리 폴백을 지원하는 기본 토큰 저장소입니다.
 */
export function createBrowserTokenStorage(): TokenStorage {
  let memoryTokens: StoredTokens | null = null;
  let usePersistent = true;

  function readFromWebStorage(
    storage: Storage | undefined,
  ): StoredTokens | null {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredTokens>;
      if (
        typeof parsed.accessToken === "string" &&
        parsed.accessToken.length > 0 &&
        typeof parsed.refreshToken === "string" &&
        parsed.refreshToken.length > 0
      ) {
        return {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
        };
      }
    } catch {
      // Ignore storage access or parse errors
    }
    return null;
  }

  return {
    getTokens(): StoredTokens | null {
      if (memoryTokens) return memoryTokens;
      if (typeof window !== "undefined") {
        const sessionTokens = readFromWebStorage(window.sessionStorage);
        if (sessionTokens) {
          usePersistent = false;
          memoryTokens = sessionTokens;
          return sessionTokens;
        }
        const localTokens = readFromWebStorage(window.localStorage);
        if (localTokens) {
          usePersistent = true;
          memoryTokens = localTokens;
          return localTokens;
        }
      }
      return null;
    },

    setTokens(tokens: StoredTokens, persistent?: boolean): void {
      if (typeof persistent === "boolean") {
        usePersistent = persistent;
      }
      memoryTokens = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
      if (typeof window !== "undefined") {
        try {
          const serialized = JSON.stringify(memoryTokens);
          if (usePersistent) {
            window.localStorage?.setItem(STORAGE_KEY, serialized);
            window.sessionStorage?.removeItem(STORAGE_KEY);
          } else {
            window.sessionStorage?.setItem(STORAGE_KEY, serialized);
            window.localStorage?.removeItem(STORAGE_KEY);
          }
        } catch {
          // Ignore quota or privacy mode errors
        }
      }
    },

    clearTokens(): void {
      memoryTokens = null;
      if (typeof window !== "undefined") {
        try {
          window.localStorage?.removeItem(STORAGE_KEY);
          window.sessionStorage?.removeItem(STORAGE_KEY);
        } catch {
          // Ignore storage errors
        }
      }
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
   */
  async function refresh(explicitRefreshToken?: string): Promise<TokenPair> {
    if (inFlightRefresh && !explicitRefreshToken) {
      return inFlightRefresh;
    }

    const currentTokens = storage.getTokens();
    const tokenToUse = explicitRefreshToken ?? currentTokens?.refreshToken;
    if (!tokenToUse) {
      storage.clearTokens();
      options.onAuthFailure?.();
      throw new ApiError(401, "UNAUTHENTICATED", "Refresh token is missing.");
    }

    const runRefresh = async (): Promise<TokenPair> => {
      try {
        const response = await fetchFn(`${baseUrl}/api/auth/refresh`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refreshToken: tokenToUse }),
        });
        const nextTokens = await parseResponse<TokenPair>(response);
        storage.setTokens({
          accessToken: nextTokens.accessToken,
          refreshToken: nextTokens.refreshToken,
        });
        return nextTokens;
      } catch (error) {
        storage.clearTokens();
        options.onAuthFailure?.();
        throw error;
      } finally {
        inFlightRefresh = null;
      }
    };

    if (!explicitRefreshToken) {
      inFlightRefresh = runRefresh();
      return inFlightRefresh;
    }
    return runRefresh();
  }

  /**
   * 공통 API 요청을 전송하고, 인증 요청에서 401이 반환되면 `refresh()` 후 정확히 1회 재시도합니다.
   */
  async function request<T>(
    path: string,
    reqOptions: RequestOptions = {},
    hasRetried = false,
  ): Promise<T> {
    const method = reqOptions.method ?? "GET";
    const requiresAuth = reqOptions.requiresAuth ?? true;
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

    if (requiresAuth) {
      const tokens = storage.getTokens();
      if (tokens?.accessToken) {
        headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
    }

    const response = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      body: isFormData
        ? (reqOptions.body as FormData)
        : reqOptions.body !== undefined
          ? JSON.stringify(reqOptions.body)
          : undefined,
    });

    if (response.status === 401 && requiresAuth && !hasRetried) {
      const currentTokens = storage.getTokens();
      if (currentTokens?.refreshToken) {
        await refresh();
        return request<T>(path, reqOptions, true);
      }
    }

    if (response.status === 401 && requiresAuth && hasRetried) {
      storage.clearTokens();
      options.onAuthFailure?.();
    }

    return parseResponse<T>(response);
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
   * @param remember - `true`면 `localStorage`, `false`면 `sessionStorage`에 토큰 보관
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
    try {
      const tokens = storage.getTokens();
      if (tokens?.accessToken || tokens?.refreshToken) {
        await request<void>("/api/auth/logout", {
          method: "POST",
          requiresAuth: true,
        });
      }
    } finally {
      storage.clearTokens();
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
   * 42 Intra OAuth 로그인을 시작합니다 (`POST /api/auth/oauth/42/login`).
   * 반환된 `flowToken`은 브라우저 `sessionStorage`에 자동 보관됩니다.
   */
  async function startOAuth42Login(): Promise<OAuthAuthorizeResponse> {
    const res = await request<OAuthAuthorizeResponse>(
      "/api/auth/oauth/42/login",
      {
        method: "POST",
        requiresAuth: false,
      },
    );
    saveOAuthFlowToken(res.flowToken);
    return res;
  }

  /**
   * 현재 로그인된 계정에 42 Intra 계정 연결을 시작합니다 (`POST /api/auth/oauth/42/link`).
   * 반환된 `flowToken`은 브라우저 `sessionStorage`에 자동 보관됩니다.
   */
  async function startOAuth42Link(): Promise<OAuthAuthorizeResponse> {
    const res = await request<OAuthAuthorizeResponse>(
      "/api/auth/oauth/42/link",
      {
        method: "POST",
        requiresAuth: true,
      },
    );
    saveOAuthFlowToken(res.flowToken);
    return res;
  }

  /**
   * 42 OAuth 리다이렉트 콜백(`code`, `state`, `flowToken`)을 서버로 전달하여 로그인·2FA 챌린지·계정 연결을 완료합니다 (`POST /api/auth/oauth/42/callback`).
   * @throws ApiError flowToken이 없거나 서버가 콜백을 거절한 경우
   * @throws TypeError 네트워크 요청에 실패한 경우
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
      clearOAuthFlowToken();
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

export const authApi = createAuthApiClient();
