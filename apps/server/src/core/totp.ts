import { createHmac, randomBytes } from "node:crypto";

// RFC 6238 TOTP with the authenticator-app defaults: HMAC-SHA1, 6 digits, 30 s.
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 20바이트 난수로 base32 TOTP secret을 만듭니다. */
export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / PERIOD_SECONDS);
}

/**
 * 한 time step의 6자리 TOTP 코드를 계산합니다(RFC 6238, HMAC-SHA1).
 *
 * @param secret - base32 secret
 * @param step - 30초 단위 time step ({@link currentStep})
 */
export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * TOTP 코드를 검증하고 일치한 time step을 돌려줍니다.
 *
 * @param lastUsedStep - 마지막으로 성공한 step. 이 값 이하의 step은 재사용으로 보고 거절합니다.
 * @returns 일치한 step(호출자가 저장), 실패하면 `null`
 *
 * @remarks
 * 앞뒤 한 step(±30초)의 시계 오차를 허용합니다. 6자리 숫자가 아니면 바로 `null`입니다.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastUsedStep: number | null,
  now = Date.now(),
) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (lastUsedStep !== null && candidate <= lastUsedStep) continue;
    if (totpCode(secret, candidate) === code) return candidate;
  }
  return null;
}

/** 인증 앱 등록용 `otpauth://totp/...` URL을 만듭니다. QR 코드에 담는 값이며 secret이 포함됩니다. */
export function otpauthUrl(
  secret: string,
  accountName: string,
  issuer: string,
) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}
