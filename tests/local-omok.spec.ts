import { test, expect, type Page } from "@playwright/test";
const cell = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name},`) });
test("lounge to finished match, return, restart and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push(message.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "오늘의 게임 테이블01" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "오목 한 판 시작하기" }).click();
  await expect(page.getByRole("status")).toHaveText("흑돌의 차례예요");
  for (let i = 0; i < 5; i++) {
    await cell(page, `${String.fromCharCode(65 + i)}1`).click();
    if (i < 4) await cell(page, `${String.fromCharCode(65 + i)}2`).click();
  }
  await expect(page.getByRole("status")).toHaveText("흑돌의 승리!");
  await expect(page.locator(".winning")).toHaveCount(5);
  await expect(cell(page, "O15")).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByRole("button", { name: "기권하기", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "← 게임 라운지" }).click();
  await page.getByRole("link", { name: "오목 테이블로 돌아가기" }).click();
  await expect(page.getByRole("status")).toHaveText("흑돌의 승리!");
  await page.getByRole("button", { name: "한 판 더" }).click();
  await expect(page.locator(".intersection .stone")).toHaveCount(0);
  await cell(page, "H8").click();
  await page.reload();
  await expect(page.locator(".intersection .stone")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("흑돌의 차례예요");
  expect(errors).toEqual([]);
});
test("keyboard placement, reset cancellation, resignation and narrow layout", async ({
  page,
}) => {
  await page.goto("/#/omok");
  await cell(page, "H8").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(cell(page, "I8")).toHaveAccessibleName("I8, 흑돌, 마지막 수");
  await expect(page.getByRole("status")).toHaveText("백돌의 차례예요");
  await page.getByRole("button", { name: "새 게임", exact: false }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".intersection .stone")).toHaveCount(1);
  await page.getByRole("button", { name: "기권하기", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기권하기" })
    .click();
  await expect(page.getByRole("status")).toHaveText("흑돌의 승리!");
  await page.getByRole("button", { name: "한 판 더" }).click();
  await cell(page, "A1").click();
  await page.getByRole("button", { name: "새 게임", exact: false }).click();
  await page.getByRole("button", { name: "새 게임 시작", exact: true }).click();
  await expect(page.locator(".intersection .stone")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
