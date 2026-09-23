import { expect, test } from "@playwright/test";

test("create an account, restore it on reload, logout and login", async ({
  page,
}, testInfo) => {
  const email = `player-${testInfo.project.name}-${Date.now()}@example.com`;
  const password = "correct horse battery staple";
  await page.goto("/");
  await page.getByRole("link", { name: "내 계정", exact: true }).click();
  await page.getByRole("button", { name: "처음 오셨나요? 회원가입" }).click();
  await page.getByLabel("닉네임", { exact: true }).fill("계정테스트");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page
    .getByLabel("비밀번호 확인", { exact: true })
    .fill("different password");
  await page.getByRole("button", { name: "가입하기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("일치하지");
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page.getByRole("button", { name: "가입하기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "내 계정", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "cafe_session",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "계정테스트님, 반가워요." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill("incorrect password");
  await page.getByRole("button", { name: "로그인하기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("일치하지");
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인하기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "계정테스트님, 반가워요." }),
  ).toBeVisible();
});
