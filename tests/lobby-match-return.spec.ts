import { expect, test } from "@playwright/test";
import { register } from "./helpers/accounts.ts";

const games = [
  { type: "gomoku", title: "오목", returnId: "return-active-match-btn" },
  {
    type: "othello",
    title: "오델로",
    returnId: "return-active-othello-match-btn",
  },
] as const;

for (const game of games) {
  test(`${game.type} resumes the same match from the top of the lobby`, async ({
    page,
    browser,
    baseURL,
  }) => {
    const opponentContext = await browser.newContext({ baseURL });
    try {
      const opponent = await opponentContext.newPage();
      await register(page, "resume");
      await register(opponent, "rival");
      const panel = page.getByRole("region", { name: "진행 중인 대국" });
      await expect(panel).toHaveCount(0);

      const queue = `start-matchmaking-${game.type}`;
      await page.getByTestId(queue).click();
      await opponent.getByTestId(queue).click();
      await expect(page.getByTestId(`${game.type}-match-view`)).toBeVisible();
      await expect(
        opponent.getByTestId(`${game.type}-match-view`),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/match\/\d+$/);
      await expect(opponent).toHaveURL(page.url());
      const matchUrl = page.url();
      const matchId = new URL(matchUrl).pathname.split("/").at(-1);

      const home = page.getByRole("button", { name: "Cyber Board Cafe" });
      await home.click();
      await expect(page.getByTestId("lobby-view")).toBeVisible();
      const resume = panel.getByTestId(game.returnId);
      await expect(resume).toHaveText(
        `진행 중인 ${game.title} 대국(#${matchId}) 복귀`,
      );
      await expect(page.getByTestId(/return-active.*-btn/)).toHaveCount(1);
      await expect(resume).toBeInViewport();
      const buttonBox = await resume.boundingBox();
      const catalogBox = await page
        .getByRole("region", { name: "추천 게임" })
        .boundingBox();
      expect(buttonBox!.y + buttonBox!.height).toBeLessThan(catalogBox!.y);
      expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );

      await resume.click();
      await expect(page).toHaveURL(matchUrl);
      await expect(page.getByTestId(`${game.type}-match-view`)).toBeVisible();
      await expect(page.getByTestId("turn-indicator")).toBeVisible();
      await page.getByTestId("resign-trigger-btn").click();
      await page.getByTestId("confirm-resign-btn").click();
      await expect(page.getByTestId(`${game.type}-result-panel`)).toBeVisible();
      await home.click();
      await expect(page.getByTestId("lobby-view")).toBeVisible();
      await expect(panel).toHaveCount(0);
    } finally {
      await opponentContext.close();
    }
  });
}
