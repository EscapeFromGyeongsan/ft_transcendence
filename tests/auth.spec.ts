import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

for (const remember of [true, false]) {
  test(`로그인 유지 ${remember}: refresh만 보관하고 새로고침·로그아웃을 처리한다`, async ({
    page,
    request,
  }) => {
    const nickname = `auth_${randomUUID().slice(0, 8)}`;
    const email = `${nickname}@example.test`;
    const password = `Test-${randomUUID()}`;
    const registered = await request.post("/api/auth/register", {
      data: { email, password, nickname },
    });
    expect(registered.status()).toBe(201);

    await page.goto("/");
    await page.locator("#emailInput").fill(email);
    await page.locator("#passwordInput").fill(password);
    await page.getByLabel("로그인 상태 유지").setChecked(remember);
    const loggedIn = page.waitForResponse("**/api/auth/login");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const pair = await (await loggedIn).json();
    await expect(page.locator(".cbc-avatar-trigger")).toBeVisible();

    const stored = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(
      stored[remember ? "local" : "session"]["cbc.auth.refreshToken"],
    ).toBe(pair.refreshToken);
    expect(
      stored[remember ? "session" : "local"]["cbc.auth.refreshToken"],
    ).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(pair.accessToken);
    expect(JSON.stringify(stored)).not.toContain(
      "cyber_board_cafe.auth.tokens",
    );

    let refreshCalls = 0;
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/auth/refresh") refreshCalls++;
    });
    const restored = page.waitForResponse("**/api/auth/refresh");
    await page.reload();
    expect((await restored).status()).toBe(200);
    await expect(page.locator(".cbc-avatar-trigger")).toBeVisible();
    expect(refreshCalls).toBe(1);

    await page.locator(".cbc-avatar-trigger").click();
    await page.getByRole("menuitem", { name: /로그아웃/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "로그아웃", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "로그인", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => [
        localStorage.getItem("cbc.auth.refreshToken"),
        sessionStorage.getItem("cbc.auth.refreshToken"),
      ]),
    ).toEqual([null, null]);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "로그인", exact: true }),
    ).toBeVisible();
    expect(refreshCalls).toBe(1);
  });
}

test("여러 탭에서 복원과 수동 갱신이 같은 세션을 유지한다", async ({
  page,
  context,
  request,
}) => {
  const nickname = `tabs_${randomUUID().slice(0, 8)}`;
  const email = `${nickname}@example.test`;
  const password = `Test-${randomUUID()}`;
  expect(
    (
      await request.post("/api/auth/register", {
        data: { email, password, nickname },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/");
  await page.locator("#emailInput").fill(email);
  await page.locator("#passwordInput").fill(password);
  await page.getByLabel("로그인 상태 유지").check();
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.locator(".cbc-avatar-trigger")).toBeVisible();

  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator(".cbc-avatar-trigger")).toBeVisible();

  // The first tab still holds the refresh token that the second tab rotated.
  for (const tab of [page, second]) {
    const refreshed = tab.waitForResponse("**/api/auth/refresh");
    await tab.locator(".cbc-avatar-trigger").click();
    await tab.getByRole("menuitem", { name: /세션 토큰 갱신/ }).click();
    expect((await refreshed).status()).toBe(200);
    await expect(
      tab.getByText("세션 토큰이 성공적으로 갱신되었습니다."),
    ).toBeVisible();
  }

  const restored = [
    page.waitForResponse("**/api/auth/refresh"),
    second.waitForResponse("**/api/auth/refresh"),
  ];
  await Promise.all([page.reload(), second.reload()]);
  for (const response of await Promise.all(restored)) {
    expect(response.status()).toBe(200);
  }
  for (const tab of [page, second]) {
    await expect(tab.locator(".cbc-avatar-trigger")).toBeVisible();
    expect(await tab.evaluate(() => Object.keys(localStorage).sort())).toEqual([
      "cbc.auth.refreshToken",
      "cbc.auth.sessionId",
    ]);
  }
});

test("이전 저장 형식의 로그인을 두 탭에서 동시에 이전한다", async ({
  page,
  context,
  request,
}) => {
  const nickname = `legacy_${randomUUID().slice(0, 8)}`;
  const email = `${nickname}@example.test`;
  const password = `Test-${randomUUID()}`;
  expect(
    (
      await request.post("/api/auth/register", {
        data: { email, password, nickname },
      })
    ).status(),
  ).toBe(201);
  const loggedIn = await request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(loggedIn.status()).toBe(200);
  const pair = await loggedIn.json();
  await page.goto("/");
  await page.evaluate((tokens) => {
    localStorage.setItem(
      "cyber_board_cafe.auth.tokens",
      JSON.stringify(tokens),
    );
  }, pair);

  const tabs = [await context.newPage(), await context.newPage()];
  const responses = tabs.map((tab) =>
    tab.waitForResponse("**/api/auth/refresh"),
  );
  await Promise.all(tabs.map((tab) => tab.goto("/")));
  for (const response of await Promise.all(responses))
    expect(response.status()).toBe(200);
  for (const tab of tabs)
    await expect(tab.locator(".cbc-avatar-trigger")).toBeVisible();
  const stored = await tabs[0].evaluate(() => ({ ...localStorage }));
  expect(Object.keys(stored).sort()).toEqual([
    "cbc.auth.refreshToken",
    "cbc.auth.sessionId",
  ]);
  expect(stored["cbc.auth.sessionId"]).toMatch(/^restored:/);
  expect(stored["cbc.auth.refreshToken"]).not.toBe(pair.refreshToken);
  expect(JSON.stringify(stored)).not.toContain(pair.accessToken);
});
