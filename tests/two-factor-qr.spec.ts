import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { register } from "./helpers/accounts.ts";

// Real signup and 2FA setup API; the QR code is drawn in the browser.
test("2FA setup shows a QR code next to the manual secret", async ({
  page,
}, testInfo) => {
  await register(page, "qr");
  await page
    .getByTestId("lobby-view")
    .getByRole("button", { name: "내 프로필", exact: true })
    .click();

  const setup = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/2fa/setup" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "2단계 인증(2FA) 설정 시작" })
    .click();
  const { otpauthUrl } = (await (await setup).json()) as {
    otpauthUrl: string;
  };
  expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

  const panel = page.getByTestId("two-factor-setup-panel");
  const qr = panel.getByRole("img", { name: "인증 앱 등록용 QR 코드" });
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("src", /^data:image\/svg\+xml/);
  // Decoded and drawn, not a broken image.
  expect(
    await qr.evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
    ),
  ).toBe(true);
  // The manual fallback stays available.
  await expect(panel.getByTestId("two-factor-secret-code")).toBeVisible();

  // Kept for checking the code with a scanner.
  await qr.screenshot({ path: testInfo.outputPath("two-factor-qr.png") });
  writeFileSync(testInfo.outputPath("otpauth-url.txt"), otpauthUrl);
});
