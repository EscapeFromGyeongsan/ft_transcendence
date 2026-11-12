// 42 Intra OAuth 2.0 (authorization code flow).
// Docs: https://api.intra.42.fr/apidoc/guides/web_application_flow
const AUTHORIZE_URL = "https://api.intra.42.fr/oauth/authorize";
const TOKEN_URL = "https://api.intra.42.fr/oauth/token";
const ME_URL = "https://api.intra.42.fr/v2/me";

export type OAuth42Config = {
  clientId: string;
  clientSecret: string;
  // Web page that receives ?code&state and posts them to the callback API.
  redirectUri: string;
  // Injected in tests; defaults to global fetch.
  fetch?: typeof fetch;
};

export type OAuthProfile = {
  providerUserId: string;
  email: string | null;
  login: string;
};

/** 42 API에 연결할 수 없거나 예상하지 못한 응답을 받은 경우입니다. 라우트에서 502로 바뀝니다. */
export class OAuthProviderError extends Error {}

// A 2xx body that is not a JSON object is a provider fault, not ours.
async function readJsonObject(response: Response) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OAuthProviderError("42 returned invalid JSON.");
  }
  if (typeof body !== "object" || body === null) {
    throw new OAuthProviderError("42 returned an unexpected body.");
  }
  return body as Record<string, unknown>;
}

/**
 * 42 Intra OAuth 2.0 authorization code 흐름의 클라이언트를 만듭니다.
 *
 * @remarks
 * state 생성·검증은 하지 않습니다. state는 `OAuthService`가 발급하고 확인합니다.
 */
export function create42Client(config: OAuth42Config) {
  const request = config.fetch ?? fetch;

  async function call(input: string, init: RequestInit) {
    try {
      return await request(input, init);
    } catch {
      throw new OAuthProviderError("42 API is unreachable.");
    }
  }

  return {
    authorizeUrl(state: string) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: "public",
        state,
      });
      return `${AUTHORIZE_URL}?${params}`;
    },

    /**
     * authorization code를 42 access token으로 바꾸고 사용자 프로필을 읽습니다.
     *
     * @returns 프로필. 42가 code를 거절하면(잘못됨·만료·재사용) `null`
     * @throws OAuthProviderError 42에 연결할 수 없거나 응답 형식이 예상과 다른 경우
     *
     * @remarks 42 access token은 프로필 조회에만 쓰고 저장하지 않습니다.
     */
    async exchange(code: string): Promise<OAuthProfile | null> {
      const tokenResponse = await call(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.redirectUri,
        }),
      });
      if (tokenResponse.status === 400 || tokenResponse.status === 401) {
        return null;
      }
      if (!tokenResponse.ok) throw new OAuthProviderError("42 token error.");
      const { access_token: accessToken } = await readJsonObject(tokenResponse);
      if (typeof accessToken !== "string" || !accessToken) {
        throw new OAuthProviderError("42 token missing.");
      }

      const meResponse = await call(ME_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!meResponse.ok) throw new OAuthProviderError("42 profile error.");
      const me = await readJsonObject(meResponse);
      if (typeof me.id !== "number" || typeof me.login !== "string") {
        throw new OAuthProviderError("42 profile is incomplete.");
      }
      return {
        providerUserId: String(me.id),
        email: typeof me.email === "string" && me.email ? me.email : null,
        login: me.login,
      };
    },
  };
}

export type OAuth42Client = ReturnType<typeof create42Client>;
