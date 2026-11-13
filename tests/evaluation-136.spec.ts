import { expect, test } from "@playwright/test";
import { installEvaluationFixture } from "./helpers/evaluation-fixture.ts";

test.describe("#136 UI regressions — synthetic HTTP/WS contracts", () => {
  test("42 연결 notice와 연결 상태를 표시하고 다시 열어도 연결 버튼을 잠근다", async ({
    page,
  }) => {
    const fixture = await installEvaluationFixture(page, {
      callback: "linked",
    });
    await page.goto("/oauth/42/callback?code=link&state=state");
    await expect(page.getByTestId("app-notice")).toContainText(
      "성공적으로 연결",
    );
    const button = page.getByTestId("start-oauth42-link-btn");
    await expect(button).toBeDisabled();
    await expect(button).toContainText("연결 완료");
    await page.reload();
    await expect(button).toBeDisabled();
    await page.getByLabel("닉네임", { exact: true }).fill("연결유지사용자");
    await page.getByRole("button", { name: "변경 저장", exact: true }).click();
    await expect(
      page.getByText("닉네임이 변경되었습니다.", { exact: true }),
    ).toBeVisible();
    await expect(button).toBeDisabled();
    expect(
      fixture.requests.filter((path) => path.includes("oauth/42/callback")),
    ).toHaveLength(1);
  });

  test("42 로그인 다음 2FA 화면에 인증 안내를 표시한다", async ({ page }) => {
    await installEvaluationFixture(page, {
      signedIn: false,
      callback: "twoFactor",
    });
    await page.goto("/oauth/42/callback?code=login&state=state");
    await expect(
      page.getByRole("heading", { name: "2단계 인증", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("app-notice")).toContainText(
      "2단계 인증 코드를 입력",
    );
  });

  test("42 연결 실패 후 유효한 기존 세션으로 프로필에 돌아간다", async ({
    page,
  }) => {
    await installEvaluationFixture(page, { callback: "failed" });
    await page.goto("/oauth/42/callback?code=bad&state=state");
    await page.getByTestId("oauth-callback-return-btn").click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.locator(".cbc-avatar-trigger")).toBeVisible();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("cbc.auth.refreshToken"),
      ),
    ).toBeTruthy();
  });

  for (const path of ["/me", "/friends", "/leaderboard"]) {
    test(`${path}에서도 수동 세션 갱신 결과를 한 번 표시한다`, async ({
      page,
    }) => {
      await installEvaluationFixture(page);
      await page.goto(path);
      await page.locator(".cbc-avatar-trigger").click();
      await page.getByRole("menuitem", { name: /세션 토큰 갱신/ }).click();
      await expect(page.getByTestId("app-notice")).toContainText(
        "성공적으로 갱신",
      );
      await expect(
        page.getByText("세션 토큰이 성공적으로 갱신되었습니다.", {
          exact: true,
        }),
      ).toHaveCount(1);
    });
  }

  for (const code of ["NOT_FOUND", "NOT_PARTICIPANT"] as const) {
    test(`${code}인 경기 구독을 지워 새로고침 뒤 재요청하지 않는다`, async ({
      page,
    }) => {
      const fixture = await installEvaluationFixture(page, {
        invalidMatch: code,
      });
      await page.goto("/match/999");
      await expect(page.getByTestId("lobby-view")).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("cyber_board_cafe.active_match_id"),
        ),
      ).toBeNull();
      const attempts = fixture.commands.filter(
        (message) => message.type === "match.subscribe",
      ).length;
      await page.reload();
      await expect(page.getByTestId("lobby-view")).toBeVisible();
      expect(
        fixture.commands.filter(
          (message) => message.type === "match.subscribe",
        ),
      ).toHaveLength(attempts);
    });
  }

  test("ALREADY_ACTIVE는 로비에 오류 배너 하나만 만든다", async ({ page }) => {
    await installEvaluationFixture(page, { queueError: "ALREADY_ACTIVE" });
    await page.goto("/");
    await page.getByTestId("start-matchmaking-gomoku").click();
    await expect(page.getByTestId("lobby-matchmaking-error")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(1);
  });

  test("오델로 game.error도 로비에서 한 번 표시한다", async ({ page }) => {
    const fixture = await installEvaluationFixture(page, {
      gameType: "othello",
    });
    await page.goto("/match/201");
    await expect(page.getByTestId("othello-match-view")).toBeVisible();
    fixture.send("game.error", {
      matchId: 201,
      commandId: "denied",
      code: "NOT_YOUR_TURN",
      message: "Not your turn.",
    });
    await page.locator(".cbc-brand").click();
    await expect(page.getByTestId("lobby-view")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("alert")).toContainText("NOT_YOUR_TURN");
  });

  test("대기 중 뒤로가기는 queue.leave를 보내며 늦은 joined가 화면을 되돌리지 않는다", async ({
    page,
  }) => {
    const fixture = await installEvaluationFixture(page);
    await page.goto("/");
    await page
      .getByRole("button", { name: "내 프로필", exact: true })
      .first()
      .click();
    await page.locator(".cbc-brand").click();
    await page.getByTestId("start-matchmaking-gomoku").click();
    await expect(page.getByTestId("matchmaking-view")).toBeVisible();
    await page.goBack();
    await expect
      .poll(
        () =>
          fixture.commands.filter((message) => message.type === "queue.leave")
            .length,
      )
      .toBe(1);
    fixture.send("queue.joined", { gameType: "gomoku" });
    await expect(page.getByTestId("matchmaking-view")).toHaveCount(0);
  });

  test("완료한 콜백 경로로 뒤로가도 재전송하거나 처리 중 화면에 멈추지 않는다", async ({
    page,
  }) => {
    const fixture = await installEvaluationFixture(page, { signedIn: false });
    await page.goto("/oauth/42/callback?code=done&state=state");
    await expect(page.getByTestId("lobby-view")).toBeVisible();
    await page.getByTestId("footer-link-terms").click();
    await page.evaluate(() =>
      history.pushState(null, "", "/oauth/42/callback?code=done&state=state"),
    );
    await page.goBack();
    await page.goForward();
    await expect(page.getByRole("alert")).toContainText(
      "이미 처리한 42 인증 응답",
    );
    expect(
      fixture.requests.filter((path) => path.includes("oauth/42/callback")),
    ).toHaveLength(1);
  });

  test("약관에서 돌아오거나 취소된 matching 방문 기록을 열어도 종료된 대기열을 되살리지 않는다", async ({
    page,
  }) => {
    const fixture = await installEvaluationFixture(page);
    await page.goto("/");
    await page.getByTestId("start-matchmaking-gomoku").click();
    await expect(page.getByTestId("matchmaking-view")).toBeVisible();
    await page.getByTestId("footer-link-terms").click();
    await expect
      .poll(
        () =>
          fixture.commands.filter((message) => message.type === "queue.leave")
            .length,
      )
      .toBe(1);
    await page
      .getByRole("button", { name: "이전 화면으로 돌아가기", exact: true })
      .click();
    await expect(page.getByTestId("lobby-view")).toBeVisible();
    await page.evaluate(() => history.pushState(null, "", "/matching"));
    await page.goBack();
    await page.goForward();
    await expect(page.getByTestId("lobby-view")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/matching");
    await expect(page.getByTestId("lobby-view")).toBeVisible();
    expect(
      fixture.commands.filter((message) => message.type === "queue.join"),
    ).toHaveLength(1);
  });

  test("로그아웃 모달의 포커스를 가두고 요청 중 배경으로 닫지 않으며 실패에 성공 안내를 섞지 않는다", async ({
    page,
  }) => {
    const fixture = await installEvaluationFixture(page, {
      holdLogout: true,
      logoutFails: true,
    });
    await page.goto("/");
    await page.locator(".cbc-avatar-trigger").click();
    await page.getByRole("menuitem", { name: /로그아웃/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(page.locator("#cancelLogoutBtn")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#confirmLogoutBtn")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#cancelLogoutBtn")).toBeFocused();
    await page.locator("#confirmLogoutBtn").click();
    await expect(page.locator("#cancelLogoutBtn")).toBeDisabled();
    await page.locator("#modalOverlay").click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeVisible();
    fixture.releaseLogout();
    await expect(
      page.getByRole("heading", { name: "로그인", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("서버 로그아웃 요청");
    await expect(page.getByTestId("app-notice")).toHaveCount(0);
  });

  test("계정 메뉴는 화살표·Home·End·바깥 클릭을 지원하고 화면 전환에 제목으로 포커스를 옮긴다", async ({
    page,
  }) => {
    await installEvaluationFixture(page);
    await page.goto("/");
    const trigger = page.locator(".cbc-avatar-trigger");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#menu-my-profile")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.locator("#trigger-logout-modal")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.locator("#menu-my-profile")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#menu-leaderboard")).toBeFocused();
    // The mobile menu covers the title; use an uncovered point outside it.
    await page.mouse.click(2, page.viewportSize()!.height - 2);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await trigger.click();
    await page.locator("#menu-my-profile").click();
    await expect(
      page.getByRole("heading", { name: "내 프로필 및 활동" }),
    ).toBeFocused();
  });

  for (const gameType of ["gomoku", "othello"] as const) {
    test(`${gameType} 제어권 회복·기권 모달 포커스·턴 알림을 지원한다`, async ({
      page,
    }) => {
      const fixture = await installEvaluationFixture(page, { gameType });
      await page.goto("/match/201");
      const resign = page.getByTestId("resign-trigger-btn");
      await expect(resign).toBeEnabled();
      fixture.send("session.replaced", { matchId: 201 });
      await expect(resign).toBeDisabled();
      await page
        .getByRole("button", { name: "이 탭으로 다시 연결", exact: true })
        .click();
      await expect(resign).toBeEnabled();
      const row = gameType === "othello" ? 2 : 7;
      const cell = page.locator(`button[data-row="${row}"][data-col="3"]`);
      await expect(cell).toBeEnabled();
      await cell.click();
      await expect
        .poll(
          () =>
            fixture.commands.filter(
              (message) => message.type === "game.command",
            ).length,
        )
        .toBe(1);
      await expect(page.getByTestId("turn-indicator")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      // A server acknowledgement clears the pending command before resigning.
      fixture.send("game.ack", {
        matchId: 201,
        commandId: fixture.commands.find(
          (message) => message.type === "game.command",
        )!.payload.commandId,
        stateVersion: 2,
        duplicate: false,
      });
      await resign.click();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("button", { name: "취소", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByTestId("confirm-resign-btn")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(resign).toBeFocused();
    });
  }

  test("2FA 해제 모달은 입력에 포커스하고 요청 중에는 닫히지 않는다", async ({
    page,
  }) => {
    const fixture = await installEvaluationFixture(page, { holdDisable: true });
    await page.goto("/me");
    const opener = page.getByTestId("open-2fa-disable-modal-btn");
    await opener.click();
    const input = page.getByTestId("two-factor-disable-code-input");
    await expect(input).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("confirm-2fa-disable-btn")).toBeFocused();
    await input.fill("123456");
    await page.getByTestId("confirm-2fa-disable-btn").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("two-factor-disable-modal")).toBeVisible();
    fixture.releaseDisable();
    await expect(page.getByTestId("two-factor-disable-modal")).toHaveCount(0);
    await expect(page.getByTestId("start-2fa-setup-btn")).toBeFocused();
  });

  test("매칭 타이머는 매초 live 알림을 하지 않고 reduced motion을 따른다", async ({
    page,
  }) => {
    await installEvaluationFixture(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByTestId("start-matchmaking-gomoku").click();
    const timer = page.getByTestId("matchmaking-elapsed-timer");
    await expect(timer).toHaveAttribute("aria-live", "off");
    expect(
      await timer.evaluate(
        (element) => element.closest('[aria-live="polite"]') === null,
      ),
    ).toBe(true);
    const duration = await page
      .locator(".cbc-matchmaking-radar-ping")
      .evaluate((element) => getComputedStyle(element).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
  });
});
