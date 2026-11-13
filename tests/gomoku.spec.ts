import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

test("two players finish a Gomoku match after reconnecting and see the result in their history", async ({
  page: firstPage,
  browser,
  baseURL,
}, testInfo) => {
  // The mobile and desktop projects share the same matchmaking queue.
  test.skip(
    testInfo.project.name !== "desktop",
    "Runs in one project per queue",
  );
  test.setTimeout(60_000);
  const secondContext = await browser.newContext({ baseURL });

  try {
    const secondPage = await secondContext.newPage();
    const suffix = randomUUID().slice(0, 8);
    const firstName = `first_${suffix}`;
    const secondName = `second_${suffix}`;

    await register(firstPage, firstName);
    await register(secondPage, secondName);

    await firstPage.getByTestId("start-matchmaking-gomoku").click();
    await expect(firstPage.getByTestId("matchmaking-view")).toBeVisible();
    await secondPage.getByTestId("start-matchmaking-gomoku").click();
    await expect(firstPage.getByTestId("gomoku-match-view")).toBeVisible();
    await expect(secondPage.getByTestId("gomoku-match-view")).toBeVisible();

    await expect(firstPage.getByTestId("player-card-black")).not.toHaveText(
      /대기 중/,
    );
    const firstIsBlack = await firstPage
      .getByTestId("player-card-black")
      .getByText(firstName, { exact: false })
      .isVisible();
    const black = firstIsBlack ? firstPage : secondPage;
    const white = firstIsBlack ? secondPage : firstPage;
    await cell(black, 7, 3).click();
    await expect(cell(white, 7, 3)).toHaveAttribute("data-cell-state", "black");

    const disconnectingContext = white.context();
    const matchURL = white.url();
    await white.close();
    await expect(black.getByTestId("opponent-disconnect-banner")).toBeVisible();
    const recovered = await disconnectingContext.newPage();
    await recovered.goto(matchURL);
    await expect(cell(recovered, 7, 3)).toHaveAttribute(
      "data-cell-state",
      "black",
    );
    await expect(black.getByTestId("opponent-disconnect-banner")).toBeHidden();

    for (const [turn, blackColumn] of [4, 5, 6, 7].entries()) {
      await cell(recovered, 0, turn * 2).click();
      await cell(black, 7, blackColumn).click();
    }

    for (const [page, opponent, summary] of [
      [black, firstIsBlack ? secondName : firstName, "총 1전 1승 0패 0무"],
      [recovered, firstIsBlack ? firstName : secondName, "총 1전 0승 1패 0무"],
    ] as const) {
      await expect(page.getByTestId("gomoku-result-panel")).toBeVisible();
      await page.getByTestId("result-leave-btn").click();
      await page
        .getByTestId("lobby-view")
        .getByRole("button", { name: "내 프로필" })
        .click();
      await expect(page.getByText(summary, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("row", { name: new RegExp(opponent) }),
      ).toHaveCount(1);
    }
  } finally {
    await secondContext.close();
  }
});

async function register(page: Page, nickname: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page
    .getByLabel("이메일", { exact: true })
    .fill(`${nickname}@example.test`);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(`Test-${randomUUID()}`);
  await page.getByLabel("닉네임", { exact: true }).fill(nickname);
  await page.locator("#agree-terms").check();
  const socket = page.waitForEvent("websocket", (ws) =>
    ws.url().endsWith("/api/ws"),
  );
  const authenticated = socket.then((ws) =>
    ws.waitForEvent("framereceived", (frame) =>
      String(frame.payload).includes('"auth.ok"'),
    ),
  );
  await Promise.all([
    authenticated,
    page.getByRole("button", { name: "가입하기" }).click(),
  ]);
  await expect(page.getByTestId("lobby-view")).toBeVisible();
}

function cell(page: Page, row: number, col: number) {
  return page.locator(`button[data-row="${row}"][data-col="${col}"]`);
}
