import { describe, expect, it } from "vitest";
import { createTwoFactorQrDataUrl } from "./two-factor-qr.ts";

const otpauthUrl =
  "otpauth://totp/Cyber%20Board%20Cafe%3Aqa%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Cyber+Board+Cafe&algorithm=SHA1&digits=6&period=30";

describe("createTwoFactorQrDataUrl", () => {
  it("returns an SVG data URL for the otpauth URI", async () => {
    const dataUrl = await createTwoFactorQrDataUrl(otpauthUrl);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const svg = decodeURIComponent(dataUrl!.split(",")[1]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });

  it("returns null when the text does not fit in a QR code", async () => {
    await expect(createTwoFactorQrDataUrl("x".repeat(5000))).resolves.toBe(
      null,
    );
  });
});
