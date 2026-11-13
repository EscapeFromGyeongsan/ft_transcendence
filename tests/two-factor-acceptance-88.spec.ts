import { expect, test, type Page } from "@playwright/test";
import { currentStep, totpCode } from "../apps/server/src/core/totp.ts";
import { register } from "./helpers/accounts.ts";

// 설정 secret·복구 코드·세션 토큰을 브라우저 진단 산출물에 남기지 않습니다.
test.use({ trace: "off", screenshot: "off", video: "off" });

function postResponse(page: Page, path: string) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().method() === "POST",
  );
}

async function openOwnProfile(page: Page) {
  await page
    .getByTestId("lobby-view")
    .getByRole("button", { name: "내 프로필", exact: true })
    .click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(
    page.getByRole("heading", { name: "내 프로필 및 활동", exact: true }),
  ).toBeVisible();
}

async function logout(page: Page) {
  await page.locator(".cbc-avatar-trigger").click();
  await page.getByRole("menuitem", { name: /로그아웃/ }).click();
  const response = postResponse(page, "/api/auth/logout");
  await page
    .getByRole("dialog", { name: "정말 로그아웃하시겠습니까?" })
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  expect((await response).status()).toBe(204);
  await expect(
    page.getByRole("heading", { name: "로그인", exact: true }),
  ).toBeVisible();
}

test("AT-16: 실제 2FA 설정·코드 재사용 거부·복구 로그인·해제", async ({
  page,
}) => {
  const account = await register(page, "totp88");

  async function login(twoFactorRequired: boolean) {
    await page.locator("#emailInput").fill(account.email);
    await page.locator("#passwordInput").fill(account.password);
    const response = postResponse(page, "/api/auth/login");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(200);
    const body = await result.json();
    expect(body.twoFactorRequired === true).toBe(twoFactorRequired);
    expect(typeof body.accessToken === "string").toBe(!twoFactorRequired);
    expect(typeof body.challengeToken === "string").toBe(twoFactorRequired);
    if (twoFactorRequired) {
      await expect(
        page.getByRole("heading", { name: "2단계 인증", exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByTestId("lobby-view")).toBeVisible();
    }
  }

  async function verify(code: string, status: 200 | 401) {
    await page.locator("#twoFactorCodeInput").fill(code);
    const response = postResponse(page, "/api/auth/2fa/verify");
    await page
      .locator("#otp-form")
      .getByRole("button", { name: "확인", exact: true })
      .click();
    const result = await response;
    expect(result.status()).toBe(status);
    if (status === 401) {
      expect((await result.json()).error.code).toBe("INVALID_TWO_FACTOR_CODE");
      await expect(page.locator("#otp-form").getByRole("alert")).toContainText(
        "인증 코드가 일치하지 않습니다",
      );
      await expect(page.getByTestId("lobby-view")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("lobby-view")).toBeVisible();
    }
  }

  await openOwnProfile(page);
  await expect(page.getByTestId("two-factor-status-pill")).toHaveText(
    "2FA 미설정",
  );
  const setup = postResponse(page, "/api/auth/2fa/setup");
  await page.getByTestId("start-2fa-setup-btn").click();
  expect((await setup).status()).toBe(200);
  await expect(page.getByTestId("two-factor-setup-panel")).toBeVisible();
  const secret = (
    await page.getByTestId("two-factor-secret-code").innerText()
  ).trim();
  expect(/^[A-Z2-7]{32}$/.test(secret)).toBe(true);
  const enablingCode = totpCode(secret, currentStep());
  await page.getByTestId("two-factor-enable-code-input").fill(enablingCode);
  const enabled = postResponse(page, "/api/auth/2fa/enable");
  await page.getByTestId("confirm-2fa-enable-btn").click();
  expect((await enabled).status()).toBe(200);
  await expect(page.getByTestId("two-factor-status-pill")).toHaveText(
    "2FA 사용 중",
  );
  const codesPanel = page.getByTestId("two-factor-recovery-codes");
  await expect(codesPanel.locator("li code")).toHaveCount(10);
  const recoveryCodes = (
    await codesPanel.locator("li code").allTextContents()
  ).map((code) => code.trim());
  expect(new Set(recoveryCodes).size).toBe(10);
  expect(
    recoveryCodes.every((code) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(code)),
  ).toBe(true);
  await page.getByTestId("ack-recovery-codes-btn").click();
  await expect(codesPanel).toHaveCount(0);

  await logout(page);
  await login(true);
  await verify(enablingCode, 401);
  await verify(recoveryCodes[0], 200);

  await logout(page);
  await login(true);
  await verify(recoveryCodes[0], 401);
  await verify(recoveryCodes[1], 200);

  await openOwnProfile(page);
  await expect(page.getByTestId("two-factor-recovery-codes")).toHaveCount(0);
  await page.getByTestId("open-2fa-disable-modal-btn").click();
  await expect(page.getByTestId("two-factor-disable-modal")).toBeVisible();
  await page
    .getByTestId("two-factor-disable-code-input")
    .fill(recoveryCodes[2]);
  const disabled = postResponse(page, "/api/auth/2fa/disable");
  await page.getByTestId("confirm-2fa-disable-btn").click();
  expect((await disabled).status()).toBe(204);
  await expect(page.getByTestId("two-factor-disable-modal")).toHaveCount(0);
  await expect(page.getByTestId("two-factor-status-pill")).toHaveText(
    "2FA 미설정",
  );

  await logout(page);
  await login(false);
});
