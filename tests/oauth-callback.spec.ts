import { expect, test } from "@playwright/test";

// HTTP·WS fixture로 개발 StrictMode의 콜백 중복과 토큰 보관·복원을 검증합니다. 실제 42 연동 검증은 아닙니다.
test("StrictMode에서 OAuth 콜백을 한 번만 전송하고 refresh만 보관해 새로고침 후 복원한다", async ({
  page,
}) => {
  const tokens = {
    accessToken: "oauth-access",
    refreshToken: "oauth-refresh",
    tokenType: "Bearer",
    expiresIn: 1800,
  };
  const restoredTokens = {
    ...tokens,
    accessToken: "restored-oauth-access",
    refreshToken: "rotated-oauth-refresh",
  };
  const user = {
    id: 7,
    email: "oauth@example.test",
    nickname: "oauth-player",
    avatarUrl: null,
    createdAt: "2026-11-12T00:00:00.000Z",
    recordsPublic: true,
  };
  let callbackCalls = 0;
  let refreshCalls = 0;
  const profileAuthorizations: (string | undefined)[] = [];
  await page.addInitScript(() => {
    if (location.pathname === "/oauth/42/callback") {
      sessionStorage.setItem("cyber_board_cafe.oauth42.flow_token", "flow-1");
    }
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/oauth/42/callback") {
        callbackCalls++;
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({
          code: "code-1",
          state: "state-1",
          flowToken: "flow-1",
        });
        await route.fulfill(
          callbackCalls === 1
            ? { json: tokens }
            : {
                status: 401,
                json: {
                  error: {
                    code: "OAUTH_STATE_INVALID",
                    message: "State already used.",
                  },
                },
              },
        );
      } else if (path === "/api/auth/refresh") {
        refreshCalls++;
        expect(route.request().postDataJSON()).toEqual({
          refreshToken: tokens.refreshToken,
        });
        await route.fulfill({ json: restoredTokens });
      } else if (path === "/api/users/me") {
        profileAuthorizations.push(route.request().headers().authorization);
        await route.fulfill({ json: user });
      } else {
        await route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND" } },
        });
      }
    },
  );
  await page.routeWebSocket("**/api/ws", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string };
      if (message.type === "auth") {
        socket.send(
          JSON.stringify({
            v: 1,
            type: "auth.ok",
            payload: { userId: user.id, activeMatchId: null },
          }),
        );
      } else if (message.type === "ping") {
        socket.send(JSON.stringify({ v: 1, type: "pong", payload: {} }));
      }
    });
  });

  await page.goto("/oauth/42/callback?code=code-1&state=state-1");
  await expect(page.locator(".cbc-avatar-trigger")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(callbackCalls).toBe(1);
  expect(refreshCalls).toBe(0);
  expect(profileAuthorizations).toContain(`Bearer ${tokens.accessToken}`);
  const stored = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(stored.local["cbc.auth.refreshToken"]).toBe(tokens.refreshToken);
  expect(stored.session["cbc.auth.refreshToken"]).toBeUndefined();
  expect(stored.session["cyber_board_cafe.oauth42.flow_token"]).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain(tokens.accessToken);

  await page.reload();
  await expect(page.locator(".cbc-avatar-trigger")).toBeVisible();
  expect(callbackCalls).toBe(1);
  expect(refreshCalls).toBe(1);
  expect(profileAuthorizations).toContain(
    `Bearer ${restoredTokens.accessToken}`,
  );
  const restored = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(restored.local["cbc.auth.refreshToken"]).toBe(
    restoredTokens.refreshToken,
  );
  expect(JSON.stringify(restored)).not.toContain(restoredTokens.accessToken);
});
