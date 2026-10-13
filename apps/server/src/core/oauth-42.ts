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

// The provider could not be reached or answered unexpectedly (maps to 502).
export class OAuthProviderError extends Error {}

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

    // Returns null when 42 rejects the code (invalid, expired or reused).
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
      const { access_token: accessToken } = (await tokenResponse.json()) as {
        access_token?: string;
      };
      if (!accessToken) throw new OAuthProviderError("42 token missing.");

      const meResponse = await call(ME_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!meResponse.ok) throw new OAuthProviderError("42 profile error.");
      const me = (await meResponse.json()) as {
        id?: number;
        login?: string;
        email?: string | null;
      };
      if (typeof me.id !== "number" || typeof me.login !== "string") {
        throw new OAuthProviderError("42 profile is incomplete.");
      }
      return {
        providerUserId: String(me.id),
        email: me.email ?? null,
        login: me.login,
      };
    },
  };
}

export type OAuth42Client = ReturnType<typeof create42Client>;
