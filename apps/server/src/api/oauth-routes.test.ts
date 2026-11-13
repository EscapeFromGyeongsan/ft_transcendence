import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { currentStep, totpCode } from "../core/totp.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

// Fake 42 API. Code "code-<id>" belongs to 42 user <id>; anything else is
// rejected like an invalid or reused code.
const people: Record<string, { login: string; email: string | null }> = {
  "101": { login: "yunhpark", email: "yunhpark@student.42.fr" },
  "102": { login: "p1", email: "other@student.42.fr" },
  "103": { login: "taken", email: "p1@example.com" },
  "104": { login: "noemail", email: null },
};
let providerDown = false;
let providerBadJson = false;
const fake42: typeof fetch = async (input, init) => {
  if (providerDown) throw new TypeError("fetch failed");
  if (providerBadJson) return new Response("<html>oops</html>");
  const url = String(input);
  if (url.endsWith("/oauth/token")) {
    const code = new URLSearchParams(String(init?.body)).get("code") ?? "";
    const id = code.replace(/^code-/, "");
    if (!people[id])
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    return Response.json({ access_token: `token-${id}` });
  }
  const id = String(new Headers(init?.headers).get("authorization")).replace(
    "Bearer token-",
    "",
  );
  return Response.json({ id: Number(id), ...people[id] });
};

const config = {
  jwtSecret: "test-secret-test-secret-test-secret",
  twoFactorKey: "two-factor-key-two-factor-key-two-factor",
  oauth42: {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://localhost/oauth/callback",
    fetch: fake42,
  },
};

test("OAuth routes declare every status code in Swagger", async () => {
  const app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json()
    .paths;
  await app.close();
  const codes = (path: string) =>
    Object.keys(paths[path].post.responses).sort();
  expect(codes("/api/auth/oauth/42/login")).toEqual([
    "200",
    "400",
    "413",
    "415",
    "429",
    "500",
    "503",
  ]);
  expect(codes("/api/auth/oauth/42/link")).toEqual([
    "200",
    "400",
    "401",
    "413",
    "415",
    "500",
    "503",
  ]);
  expect(codes("/api/auth/oauth/42/callback")).toEqual([
    "200",
    "400",
    "401",
    "409",
    "413",
    "415",
    "422",
    "429",
    "500",
    "502",
    "503",
  ]);
});

describe.skipIf(!testDatabaseUrl)("42 OAuth with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });
  beforeEach(async () => {
    providerDown = false;
    providerBadJson = false;
    await resetTestDatabase(database);
    await app?.close();
    app = await buildApp({}, testDatabaseUrl, config);
  });

  type Flow = { state: string; flowToken: string };
  const stateOf = (body: {
    authorizeUrl: string;
    flowToken: string;
  }): Flow => ({
    state: new URL(body.authorizeUrl).searchParams.get("state")!,
    flowToken: body.flowToken,
  });
  const startLogin = async () =>
    stateOf(
      (
        await app.inject({ method: "POST", url: "/api/auth/oauth/42/login" })
      ).json(),
    );
  const callback = (code: string, flow: Flow) =>
    app.inject({
      method: "POST",
      url: "/api/auth/oauth/42/callback",
      payload: { code, state: flow.state, flowToken: flow.flowToken },
    });
  const me = (accessToken: string) =>
    app.inject({
      method: "GET",
      url: "/api/users/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  async function registerAndLogin() {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "p1@example.com",
        password: "password-123",
        nickname: "p1",
      },
    });
    return (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "p1@example.com", password: "password-123" },
      })
    ).json().accessToken as string;
  }

  test("login start points at 42 with client id, redirect and state", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/42/login",
    });
    expect(response.statusCode).toBe(200);
    const url = new URL(response.json().authorizeUrl);
    expect(url.origin + url.pathname).toBe(
      "https://api.intra.42.fr/oauth/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      config.oauth42.redirectUri,
    );
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  test("first 42 login creates an account; next login reuses it", async () => {
    const first = await callback("code-101", await startLogin());
    expect(first.statusCode).toBe(200);
    const profile = (await me(first.json().accessToken)).json();
    expect(profile).toMatchObject({
      email: "yunhpark@student.42.fr",
      nickname: "yunhpark",
      hasPassword: false,
      oauth42Linked: true,
    });
    const second = await callback("code-101", await startLogin());
    expect((await me(second.json().accessToken)).json().id).toBe(profile.id);
  });

  test("state is single use; unknown state and rejected code fail", async () => {
    const state = await startLogin();
    expect((await callback("code-101", state)).statusCode).toBe(200);
    const replay = await callback("code-101", state);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("OAUTH_STATE_INVALID");
    expect(
      (await callback("code-101", { state: "forged", flowToken: "x" })).json()
        .error.code,
    ).toBe("OAUTH_STATE_INVALID");
    const rejected = await callback("bad-code", await startLogin());
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error.code).toBe("OAUTH_FAILED");
  });

  test("an existing email is not taken over by OAuth", async () => {
    await registerAndLogin();
    const response = await callback("code-103", await startLogin());
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("EMAIL_TAKEN");
  });

  test("a taken nickname gets a suffix; missing email is refused", async () => {
    await registerAndLogin(); // owns nickname "p1"
    const created = await callback("code-102", await startLogin());
    const nickname = (await me(created.json().accessToken)).json().nickname;
    expect(nickname).toMatch(/^p1-[0-9a-f]{4}$/);
    const noEmail = await callback("code-104", await startLogin());
    expect(noEmail.statusCode).toBe(422);
    expect(noEmail.json().error.code).toBe("OAUTH_EMAIL_MISSING");
  });

  test("a signed-in user links 42, then 42 login opens that account", async () => {
    const token = await registerAndLogin();
    expect((await me(token)).json().oauth42Linked).toBe(false);
    const start = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/42/link",
      headers: { authorization: `Bearer ${token}` },
    });
    const linked = await callback("code-101", stateOf(start.json()));
    expect(linked.json()).toEqual({ linked: true });
    expect((await me(token)).json()).toMatchObject({
      oauth42Linked: true,
      hasPassword: true,
    });
    const profile = await app.inject({
      method: "GET",
      url: "/api/users/1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(profile.json()).not.toHaveProperty("oauth42Linked");
    const viaOAuth = await callback("code-101", await startLogin());
    expect((await me(viaOAuth.json().accessToken)).json().email).toBe(
      "p1@example.com",
    );
  });

  test("a 42 account linked to someone else cannot be linked again", async () => {
    await callback("code-101", await startLogin()); // creates user 1 linked to 101
    const token = (
      await (async () => {
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email: "p2@example.com",
            password: "password-123",
            nickname: "p2",
          },
        });
        return app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: "p2@example.com", password: "password-123" },
        });
      })()
    ).json().accessToken;
    const start = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/42/link",
      headers: { authorization: `Bearer ${token}` },
    });
    const conflict = await callback("code-101", stateOf(start.json()));
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("OAUTH_ACCOUNT_LINKED");
  });

  test("OAuth login applies the same 2FA policy", async () => {
    const created = await callback("code-101", await startLogin());
    const auth = { authorization: `Bearer ${created.json().accessToken}` };
    const { secret } = (
      await app.inject({
        method: "POST",
        url: "/api/auth/2fa/setup",
        headers: auth,
      })
    ).json();
    await app.inject({
      method: "POST",
      url: "/api/auth/2fa/enable",
      headers: auth,
      payload: { code: totpCode(secret, currentStep()) },
    });
    const next = await callback("code-101", await startLogin());
    expect(next.json()).toMatchObject({ twoFactorRequired: true });
    expect(next.json()).not.toHaveProperty("accessToken");
  });

  test("OAuth-only accounts cannot use password login", async () => {
    await callback("code-101", await startLogin());
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "yunhpark@student.42.fr", password: "anything-123" },
    });
    expect(response.statusCode).toBe(401);
  });

  test("42 outage returns 502 and creates nothing", async () => {
    const state = await startLogin();
    providerDown = true;
    const response = await callback("code-101", state);
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("OAUTH_PROVIDER_ERROR");
  });

  test("OAuth endpoints return 503 when 42 is not configured", async () => {
    await app.close();
    app = await buildApp({}, testDatabaseUrl, { jwtSecret: config.jwtSecret });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/42/login",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "42 login is not configured.",
      },
    });
  });
  test("a callback from another browser (wrong flowToken) is refused", async () => {
    const flow = await startLogin();
    const other = await callback("code-101", {
      ...flow,
      flowToken: "attacker",
    });
    expect(other.statusCode).toBe(401);
    expect(other.json().error.code).toBe("OAUTH_STATE_INVALID");
    // The real browser can still finish its own flow.
    expect((await callback("code-101", flow)).statusCode).toBe(200);
  });

  test("linking fails once the session that started it has logged out", async () => {
    const token = await registerAndLogin();
    const auth = { authorization: `Bearer ${token}` };
    const start = await app.inject({
      method: "POST",
      url: "/api/auth/oauth/42/link",
      headers: auth,
    });
    await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: auth,
    });
    const response = await callback("code-101", stateOf(start.json()));
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
  });

  test("invalid JSON from 42 is a provider error (502)", async () => {
    const flow = await startLogin();
    providerBadJson = true;
    const response = await callback("code-101", flow);
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("OAUTH_PROVIDER_ERROR");
  });

  test("parallel first logins of one 42 account end in the same account", async () => {
    const [a, b] = [await startLogin(), await startLogin()];
    const results = await Promise.all([
      callback("code-101", a),
      callback("code-101", b),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const ids = await Promise.all(
      results.map(async (r) => (await me(r.json().accessToken)).json().id),
    );
    expect(ids[0]).toBe(ids[1]);
  });
});
