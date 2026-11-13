import { expect, test } from "@playwright/test";
import { register, boardCell } from "./helpers/accounts.ts";

for (const gameType of ["gomoku", "othello"] as const) {
  test(`${gameType}: 실제 두 사용자와 두 탭의 제어권 재획득 뒤 착수·기권 (#136)`, async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "One run per shared queue.");
    test.setTimeout(90_000);
    const opponentContext = await browser.newContext({ baseURL });
    try {
      // Local trusted-proxy clients use separate IPs without mocking responses.
      const offset = gameType === "gomoku" ? 10 : 20;
      for (const [context, lastOctet] of [
        [page.context(), offset],
        [opponentContext, offset + 1],
      ] as const) {
        await context.route("**/api/**", (route) =>
          route.continue({
            headers: {
              ...route.request().headers(),
              "x-forwarded-for": `192.0.2.${lastOctet}`,
            },
          }),
        );
      }
      const opponent = await opponentContext.newPage();
      const user = await register(page, "owner");
      await register(opponent, "opponent");
      await page.getByTestId(`start-matchmaking-${gameType}`).click();
      await expect(page.getByTestId("matchmaking-view")).toBeVisible();
      await opponent.getByTestId(`start-matchmaking-${gameType}`).click();
      await expect(page.getByTestId(`${gameType}-match-view`)).toBeVisible();
      await expect(
        opponent.getByTestId(`${gameType}-match-view`),
      ).toBeVisible();
      const mirror = await page.context().newPage();
      await mirror.goto(page.url());
      await expect(page.getByTestId("session-replaced-banner")).toBeVisible();
      await expect(page.getByTestId("resign-trigger-btn")).toBeDisabled();
      await page
        .getByRole("button", { name: "이 탭으로 다시 연결", exact: true })
        .click();
      await expect(page.getByTestId("resign-trigger-btn")).toBeEnabled();
      await expect(mirror.getByTestId("session-replaced-banner")).toBeVisible();
      const isBlack = await page
        .getByTestId("player-card-black")
        .getByText(user.nickname, { exact: false })
        .isVisible();
      if (!isBlack) {
        const [row, col] = gameType === "gomoku" ? [7, 7] : [2, 3];
        await boardCell(opponent, row, col).click();
        await expect(boardCell(page, row, col)).toHaveAttribute(
          "data-cell-state",
          "black",
        );
      }
      const [row, col] =
        gameType === "gomoku" ? [7, isBlack ? 7 : 8] : [2, isBlack ? 3 : 2];
      await boardCell(page, row, col).click();
      await expect(boardCell(opponent, row, col)).toHaveAttribute(
        "data-cell-state",
        isBlack ? "black" : "white",
      );
      await expect(boardCell(mirror, row, col)).toHaveAttribute(
        "data-cell-state",
        isBlack ? "black" : "white",
      );
      await expect(mirror.getByTestId("resign-trigger-btn")).toBeDisabled();
      await page.getByTestId("resign-trigger-btn").click();
      await page.getByTestId("confirm-resign-btn").click();
      await expect(page.getByTestId(`${gameType}-result-panel`)).toBeVisible();
      await expect(
        opponent.getByTestId(`${gameType}-result-panel`),
      ).toBeVisible();
    } finally {
      await opponentContext.close();
    }
  });
}
