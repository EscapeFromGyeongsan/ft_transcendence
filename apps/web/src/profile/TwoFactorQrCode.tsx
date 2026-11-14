import { useEffect, useState } from "react";
import { createTwoFactorQrDataUrl } from "./two-factor-qr.ts";

/**
 * 2FA 설정 화면에서 `otpauth://` URI를 QR 코드로 보여 줍니다.
 *
 * @remarks 만들지 못하면 아무것도 그리지 않으며, 수동 입력용 시크릿 안내는 그대로 남습니다.
 */
export function TwoFactorQrCode({ otpauthUrl }: { otpauthUrl: string }) {
  const [qr, setQr] = useState<{ url: string; src: string | null } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    void createTwoFactorQrDataUrl(otpauthUrl).then((src) => {
      if (active) setQr({ url: otpauthUrl, src });
    });
    return () => {
      active = false;
    };
  }, [otpauthUrl]);

  // Show only the code for the current URI, never one from an earlier setup.
  if (!qr?.src || qr.url !== otpauthUrl) return null;
  return (
    <img
      className="cbc-2fa-qr"
      src={qr.src}
      width={176}
      height={176}
      alt="인증 앱 등록용 QR 코드"
      data-testid="two-factor-qr"
    />
  );
}
