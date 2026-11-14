/**
 * 인증 앱 등록용 `otpauth://` URI를 QR 코드 이미지(SVG data URL)로 만듭니다.
 *
 * @returns `<img src>`에 넣을 data URL. 만들 수 없으면 `null`(호출자는 수동 입력 안내만 표시)
 *
 * @remarks
 * URI에 TOTP secret이 들어 있으므로 외부 QR 서비스를 쓰지 않고 브라우저 안에서만 만듭니다.
 * 라이브러리는 2FA 설정을 시작할 때만 받도록 따로 불러옵니다.
 */
export async function createTwoFactorQrDataUrl(
  otpauthUrl: string,
): Promise<string | null> {
  try {
    const { default: QRCode } = await import("qrcode");
    const svg = await QRCode.toString(otpauthUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return null;
  }
}
