import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { boardCell, register } from "./helpers/accounts.ts";
import { finishGomoku } from "./helpers/matches.ts";

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let step = 0; step < 80; step++) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  await expect(target, "The control must be reachable using Tab").toBeFocused();
}

function observeBrowser() {
  const report = {
    console: [] as {
      page: string;
      type: string;
      text: string;
      location: unknown;
    }[],
    pageErrors: [] as { page: string; message: string }[],
    failedRequests: [] as {
      url: string;
      method: string;
      error: string | null;
    }[],
    httpErrors: [] as { url: string; method: string; status: number }[],
    requests: [] as string[],
    sockets: [] as { url: string; authenticated: boolean; errors: string[] }[],
  };
  const watchPage = (page: Page) => {
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error")
        report.console.push({
          page: page.url(),
          type: message.type(),
          text: message.text(),
          location: message.location(),
        });
    });
    page.on("pageerror", (error) =>
      report.pageErrors.push({
        page: page.url(),
        message: error.stack ?? error.message,
      }),
    );
    page.on("websocket", (socket) => {
      const entry = {
        url: socket.url(),
        authenticated: false,
        errors: [] as string[],
      };
      report.sockets.push(entry);
      socket.on("socketerror", (error) => entry.errors.push(error));
      if (new URL(socket.url()).pathname === "/api/ws")
        socket.on("framereceived", ({ payload }) => {
          try {
            if (JSON.parse(String(payload)).type === "auth.ok")
              entry.authenticated = true;
          } catch {
            entry.errors.push(`Invalid JSON frame: ${String(payload)}`);
          }
        });
    });
  };
  return {
    report,
    watch(context: BrowserContext) {
      for (const page of context.pages()) watchPage(page);
      context.on("page", watchPage);
      context.on("request", (request) => report.requests.push(request.url()));
      context.on("requestfailed", (request) =>
        report.failedRequests.push({
          url: request.url(),
          method: request.method(),
          error: request.failure()?.errorText ?? null,
        }),
      );
      context.on("response", (response) => {
        if (response.status() >= 400)
          report.httpErrors.push({
            url: response.url(),
            method: response.request().method(),
            status: response.status(),
          });
      });
    },
  };
}

test("#88 real HTTPS accounts, games, records and friends work with keyboard access at every viewport", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  expect(new URL(baseURL!).protocol).toBe("https:");
  const viewports = {
    desktop: { width: 1440, height: 900 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 360, height: 800 },
  };
  expect(page.viewportSize()).toEqual(
    viewports[testInfo.project.name as keyof typeof viewports],
  );
  const { isMobile, hasTouch, deviceScaleFactor, userAgent } =
    testInfo.project.use;
  const secondContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize()!,
    isMobile,
    hasTouch,
    deviceScaleFactor,
    userAgent,
  });
  const diagnostics = observeBrowser();
  diagnostics.watch(page.context());
  diagnostics.watch(secondContext);
  const layouts: {
    screen: string;
    width: number;
    documentWidth: number;
    bodyWidth: number;
    secure: boolean;
  }[] = [];

  async function capture(screen: string, target = page) {
    const layout = await target.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      secure: isSecureContext,
    }));
    layouts.push({ screen, ...layout });
    const path = testInfo.outputPath(`${screen}.png`);
    await target.screenshot({ path, fullPage: true });
    await testInfo.attach(screen, { path, contentType: "image/png" });
    expect(layout.secure, `${screen}: secure browser context`).toBe(true);
    expect(
      layout.documentWidth,
      `${screen}: document horizontal overflow`,
    ).toBeLessThanOrEqual(layout.width + 1);
    expect(
      layout.bodyWidth,
      `${screen}: body horizontal overflow`,
    ).toBeLessThanOrEqual(layout.width + 1);
  }

  try {
    const secondPage = await secondContext.newPage();
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "로그인", exact: true }),
    ).toBeVisible();
    await tabTo(page, page.getByLabel("이메일", { exact: true }));
    await capture("login");
    for (const [kind, title] of [
      ["terms", "서비스 이용약관"],
      ["privacy", "개인정보처리방침"],
    ] as const) {
      await tabTo(page, page.getByTestId(`footer-link-${kind}`));
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await capture(kind);
      await tabTo(page, page.getByTestId("legal-back-btn"));
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "로그인", exact: true }),
      ).toBeVisible();
    }

    await tabTo(
      page,
      page.getByRole("button", { name: "회원가입", exact: true }),
    );
    await page.keyboard.press("Enter");
    await tabTo(page, page.getByLabel("닉네임", { exact: true }));
    await capture("signup");

    // Two real accounts per project; all subsequent flows reuse these accounts.
    const first = await register(page, "acc88a");
    const second = await register(secondPage, "acc88b");
    await capture("lobby");
    const accountTrigger = page.locator(".cbc-avatar-trigger");
    await expect(accountTrigger).toHaveAccessibleName(
      new RegExp(first.nickname),
    );
    await tabTo(page, accountTrigger);
    await page.keyboard.press("Enter");
    const accountMenu = page.getByRole("menu", { name: "계정 메뉴" });
    await expect(accountMenu).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(accountMenu.getByRole("menuitem").first()).toBeFocused();
    await capture("account-menu");
    await page.keyboard.press("Escape");
    await expect(accountMenu).toBeHidden();
    await expect(accountTrigger).toBeFocused();

    await Promise.all([
      finishGomoku(page, secondPage, [first.nickname, second.nickname]),
      (async () => {
        await expect(page.getByTestId("gomoku-match-view")).toBeVisible();
        await capture("gomoku");
      })(),
    ]);
    for (const [player, opponent] of [
      [page, second.nickname],
      [secondPage, first.nickname],
    ] as const) {
      await player
        .getByTestId("lobby-view")
        .getByRole("button", { name: "내 프로필", exact: true })
        .click();
      await expect(
        player.getByRole("heading", { name: "내 프로필 및 활동", exact: true }),
      ).toBeVisible();
      await expect(player.locator(".cbc-profile-total")).toContainText(
        "총 1전",
      );
      await expect(
        player.getByRole("row", { name: new RegExp(opponent) }),
      ).toHaveCount(1);
    }
    await capture("profile-records");
    const deleteTrigger = page.getByTestId("open-delete-account-btn");
    await tabTo(page, deleteTrigger);
    await page.keyboard.press("Enter");
    const deletionDialog = page.getByRole("alertdialog", {
      name: "정말 회원 탈퇴할까요?",
    });
    await expect(deletionDialog).toHaveAttribute("aria-modal", "true");
    const password = page.getByTestId("delete-account-password");
    await expect(password).toBeFocused();
    await expect(password).toHaveAccessibleName(/비밀번호/);
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("delete-account-confirm")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();
    await capture("account-deletion-dialog");
    await page.keyboard.press("Escape");
    await expect(deletionDialog).toBeHidden();
    await expect(deleteTrigger).toBeFocused();

    for (const player of [page, secondPage]) {
      await player
        .getByRole("button", { name: "친구 관리", exact: true })
        .click();
      await expect(player.getByTestId("friends-view")).toBeVisible();
      await expect(
        player.getByText("아직 친구가 없습니다.", { exact: true }),
      ).toBeVisible();
    }
    await tabTo(page, page.getByLabel("닉네임으로 검색"));
    await page.keyboard.type(second.nickname);
    await tabTo(page, page.getByRole("button", { name: "검색", exact: true }));
    await page.keyboard.press("Enter");
    const sendRequest = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/friends/requests" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("list", { name: "검색 결과" })
      .getByRole("button", { name: "친구 요청", exact: true })
      .click();
    expect((await sendRequest).status()).toBe(201);
    const incoming = secondPage.getByRole("list", {
      name: "받은 요청",
      exact: true,
    });
    await expect(
      incoming.getByText(first.nickname, { exact: true }),
    ).toBeVisible();
    await incoming.getByRole("button", { name: "수락", exact: true }).click();
    for (const [player, friend] of [
      [page, second.nickname],
      [secondPage, first.nickname],
    ] as const) {
      const friends = player.getByRole("list", {
        name: "친구 목록",
        exact: true,
      });
      await expect(friends.getByText(friend, { exact: true })).toBeVisible();
      await expect(friends.getByText("온라인", { exact: true })).toBeVisible();
    }
    await capture("friends");
    for (const player of [page, secondPage]) {
      await player
        .getByRole("button", { name: "← 로비로", exact: true })
        .click();
      await expect(player.getByTestId("lobby-view")).toBeVisible();
    }

    await page.getByTestId("start-matchmaking-othello").click();
    await expect(page.getByTestId("matchmaking-view")).toBeVisible();
    await capture("matchmaking");
    await secondPage.getByTestId("start-matchmaking-othello").click();
    for (const player of [page, secondPage])
      await expect(player.getByTestId("othello-match-view")).toBeVisible();
    await expect(page).toHaveURL(secondPage.url());
    await expect(page.getByTestId("player-card-black")).toContainText(
      new RegExp(`${first.nickname}|${second.nickname}`),
    );
    const firstIsBlack = await page
      .getByTestId("player-card-black")
      .getByText(first.nickname, { exact: false })
      .isVisible();
    const black = firstIsBlack ? page : secondPage;
    await expect(black.locator('[data-legal-move="true"]')).toHaveCount(4);
    await boardCell(black, 2, 3).focus();
    await black.keyboard.press("Enter");
    for (const player of [page, secondPage]) {
      await expect(boardCell(player, 2, 3)).toHaveAttribute(
        "data-cell-state",
        "black",
      );
      await expect(boardCell(player, 3, 3)).toHaveAttribute(
        "data-cell-state",
        "black",
      );
      await expect(player.getByTestId("othello-disc-count-black")).toHaveText(
        "4",
      );
      await expect(player.getByTestId("othello-disc-count-white")).toHaveText(
        "1",
      );
    }
    await capture("othello");
    await black.getByTestId("resign-trigger-btn").click();
    await black.getByTestId("confirm-resign-btn").click();
    for (const player of [page, secondPage]) {
      await expect(player.getByTestId("othello-result-panel")).toBeVisible();
      await player.getByTestId("result-leave-btn").click();
      await expect(player.getByTestId("lobby-view")).toBeVisible();
    }

    const { report } = diagnostics;
    expect
      .soft(
        report.console,
        "All browser warnings/errors are retained in browser-diagnostics.json",
      )
      .toEqual([]);
    expect.soft(report.pageErrors).toEqual([]);
    expect.soft(report.failedRequests).toEqual([]);
    expect.soft(report.httpErrors).toEqual([]);
    expect(
      report.requests.filter((url) => new URL(url).protocol === "http:"),
    ).toEqual([]);
    expect(report.sockets.length).toBeGreaterThanOrEqual(2);
    for (const socket of report.sockets) {
      expect(new URL(socket.url).protocol).toBe("wss:");
      expect(socket.errors).toEqual([]);
      if (new URL(socket.url).pathname === "/api/ws")
        expect(socket.authenticated).toBe(true);
    }
  } finally {
    await testInfo.attach("browser-diagnostics.json", {
      body: JSON.stringify(diagnostics.report, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("viewport-checks.json", {
      body: JSON.stringify(
        {
          project: testInfo.project.name,
          viewport: page.viewportSize(),
          layouts,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await secondContext.close();
  }
});
