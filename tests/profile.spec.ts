import { expect, test } from "@playwright/test";
import { register } from "./helpers/accounts.ts";

test("nickname and avatar persist, public profiles hide email, and avatar deletion restores the default", async ({
  page,
  browser,
  baseURL,
}) => {
  const user = await register(page, "profile");
  const nickname = `${user.nickname}_new`;
  await page
    .getByTestId("lobby-view")
    .getByRole("button", { name: "내 프로필", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "내 프로필 및 활동" }),
  ).toBeVisible();
  const identity = page.locator(".cbc-profile-identity");
  await expect(
    identity.getByRole("img", { name: `${user.nickname} 기본 프로필 이미지` }),
  ).toBeVisible();
  await page.getByLabel("닉네임", { exact: true }).fill(nickname);
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(
    page.getByText("닉네임이 변경되었습니다.", { exact: true }),
  ).toBeVisible();

  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ff7a00";
      context.fillRect(0, 0, 2, 2);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  await page
    .getByTestId("avatar-file-input")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: png });
  const avatar = identity.getByRole("img", {
    name: `${nickname} 프로필 이미지`,
    exact: true,
  });
  await expect(avatar).toBeVisible();
  await expect
    .poll(() =>
      avatar.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(2);
  const avatarURL = await avatar.getAttribute("src");
  expect(avatarURL).toMatch(/^\/api\/media\/avatars\//);
  const served = await page.request.get(avatarURL!);
  expect(served.status()).toBe(200);
  expect(await served.body()).toEqual(png);
  await page.reload();
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue(
    nickname,
  );
  await expect(avatar).toHaveAttribute("src", avatarURL!);

  const outsiderContext = await browser.newContext({ baseURL });
  try {
    const outsider = await outsiderContext.newPage();
    await register(outsider, "viewer");
    await outsider.goto(`/users/${user.id}`);
    await expect(
      outsider.getByRole("heading", {
        name: `${nickname} 님의 프로필`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      outsider.locator(".cbc-profile-identity").getByRole("img"),
    ).toHaveAttribute("src", avatarURL!);
    await expect(outsider.getByLabel("이메일", { exact: true })).toHaveCount(0);
    await expect(
      outsider.getByRole("button", { name: "변경 저장", exact: true }),
    ).toHaveCount(0);
  } finally {
    await outsiderContext.close();
  }

  await identity.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(
    identity.getByRole("img", { name: `${nickname} 기본 프로필 이미지` }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue(
    nickname,
  );
  await expect(
    identity.getByRole("img", { name: `${nickname} 기본 프로필 이미지` }),
  ).toBeVisible();
  expect((await page.request.get(avatarURL!)).status()).toBe(404);
});
