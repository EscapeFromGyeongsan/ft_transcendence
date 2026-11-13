import { expect, test } from "@playwright/test";
import { register } from "./helpers/accounts.ts";
import { finishGomoku } from "./helpers/matches.ts";

test("profile edits persist and records privacy protects real match data while preserving leaderboard and opponent history", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
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
  const recordsSwitch = page.getByRole("switch", {
    name: "전적 공개",
    exact: true,
  });
  await expect(recordsSwitch).toBeChecked();
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
  await expect(recordsSwitch).toBeChecked();

  const outsiderContext = await browser.newContext({ baseURL });
  try {
    const outsider = await outsiderContext.newPage();
    const viewer = await register(outsider, "viewer");
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

    // Reuse the same two accounts for actual game records and privacy checks.
    await finishGomoku(page, outsider, [nickname, viewer.nickname]);
    // 화면 이동은 SPA 동선으로 확인하고, 명시적인 새로고침에서만 세션 복원을 검증합니다.
    for (const player of [page, outsider]) {
      await player
        .getByTestId("lobby-view")
        .getByRole("button", { name: "내 프로필", exact: true })
        .click();
      await expect(player).toHaveURL(/\/me$/);
    }
    await expect(page.locator(".cbc-profile-total")).toContainText("총 1전");
    await expect(
      outsider.getByRole("row", { name: new RegExp(nickname) }),
    ).toHaveCount(1);
    await recordsSwitch.click();
    await expect(recordsSwitch).not.toBeChecked();
    await expect(
      page.getByText("전적을 비공개로 설정했습니다.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(recordsSwitch).not.toBeChecked();
    await expect(page.locator(".cbc-profile-total")).toContainText("총 1전");

    // A real transport failure must leave the saved setting intact.
    await page.context().setOffline(true);
    await recordsSwitch.click();
    await expect(page.getByRole("alert")).toContainText("네트워크");
    await expect(recordsSwitch).not.toBeChecked();
    await page.context().setOffline(false);
    await page.reload();
    await expect(recordsSwitch).not.toBeChecked();

    const statsDenied = outsider.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/users/${user.id}/stats` &&
        url.searchParams.get("gameType") === "gomoku"
      );
    });
    const matchesDenied = outsider.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/users/${user.id}/matches`,
    );
    await outsider
      .getByRole("row", { name: new RegExp(nickname) })
      .getByRole("button")
      .click();
    for (const response of await Promise.all([statsDenied, matchesDenied])) {
      expect(response.status()).toBe(403);
      expect((await response.json()).error.code).toBe("RECORDS_PRIVATE");
    }
    await expect(outsider.getByTestId("records-private-notice")).toBeVisible();
    await expect(
      outsider.getByRole("heading", {
        name: `${nickname} 님의 프로필`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      outsider.locator(".cbc-profile-identity").getByRole("img"),
    ).toHaveAttribute("src", avatarURL!);
    await expect(outsider.locator(".cbc-profile-total")).toHaveCount(0);
    await expect(outsider.getByRole("table")).toHaveCount(0);

    await outsider.goto("/me");
    await expect(
      outsider.getByRole("row", { name: new RegExp(nickname) }),
    ).toHaveCount(1);
    await outsider
      .getByRole("button", { name: "리더보드 보기", exact: true })
      .click();
    await expect(
      outsider.getByRole("row", { name: new RegExp(nickname) }),
    ).toHaveCount(1);

    await recordsSwitch.click();
    await expect(recordsSwitch).toBeChecked();
    await page.reload();
    await expect(recordsSwitch).toBeChecked();
    await outsider.goto(`/users/${user.id}`);
    await expect(outsider.getByTestId("records-private-notice")).toHaveCount(0);
    await expect(outsider.locator(".cbc-profile-total")).toContainText(
      "총 1전",
    );
    await expect(
      outsider.getByRole("row", { name: new RegExp(viewer.nickname) }),
    ).toHaveCount(1);

    // Verify avatar deletion does not reset a private setting in the parent UI.
    await recordsSwitch.click();
    await expect(recordsSwitch).not.toBeChecked();
  } finally {
    await outsiderContext.close();
  }

  await identity.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(
    identity.getByRole("img", { name: `${nickname} 기본 프로필 이미지` }),
  ).toBeVisible();
  await expect(recordsSwitch).not.toBeChecked();
  await page.reload();
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue(
    nickname,
  );
  await expect(
    identity.getByRole("img", { name: `${nickname} 기본 프로필 이미지` }),
  ).toBeVisible();
  expect((await page.request.get(avatarURL!)).status()).toBe(404);

  // 통합 후보에는 실제 친구 API가 연결되어 있으므로 빈 목록도 성공 응답입니다.
  const friendsResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/friends",
  );
  await page.getByRole("button", { name: "친구 관리", exact: true }).click();
  expect((await friendsResponse).status()).toBe(200);
  await expect(page.getByTestId("friends-view")).toBeVisible();
  await expect(
    page.getByText("아직 친구가 없습니다.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
