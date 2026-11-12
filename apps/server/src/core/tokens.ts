import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** access token에 담는 인증 주체. JWT의 `sub`(userId)와 `sid`(sessionId)에 대응합니다. */
export type AccessTokenClaims = { userId: number; sessionId: string };

// Only this exact header is accepted, so "alg": "none" or algorithm swaps fail.
const HEADER = Buffer.from(
  JSON.stringify({ alg: "HS256", typ: "JWT" }),
).toString("base64url");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * HS256 JWT access token을 만듭니다.
 *
 * @param ttlSeconds - 발급 시각부터 만료까지의 초
 * @param now - 발급 시각(ms). 테스트에서만 바꿉니다.
 */
export function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
) {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: String(claims.userId),
      sid: claims.sessionId,
      iat,
      exp: iat + ttlSeconds,
    }),
  ).toString("base64url");
  const data = `${HEADER}.${payload}`;
  return `${data}.${sign(data, secret)}`;
}

/**
 * access token의 헤더·서명·claim·만료를 검사합니다.
 *
 * @returns 유효하면 claims, 아니면 `null`(예외를 던지지 않음)
 *
 * @remarks
 * 서명만 확인하며 서버 세션이 살아 있는지는 보지 않습니다. 세션 확인은 `AuthService.authenticate()`가 합니다.
 * 헤더는 고정 값과 정확히 같아야 하고, 서명은 상수 시간으로 비교합니다.
 */
export function verifyAccessToken(
  token: string,
  secret: string,
  now = Date.now(),
): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const userId = Number(payload.sub);
    if (
      !Number.isSafeInteger(userId) ||
      typeof payload.sid !== "string" ||
      !UUID.test(payload.sid) ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(now / 1000)
    ) {
      return null;
    }
    return { userId, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/**
 * 32바이트 난수로 opaque 토큰을 만듭니다.
 *
 * @remarks
 * refresh token과 2FA challenge token에 씁니다. 클라이언트는 원문을, DB는 {@link hashRefreshToken} 결과만 보관합니다.
 */
export function createRefreshToken() {
  return randomBytes(32).toString("base64url");
}

/** 저장·조회용 토큰 해시(SHA-256 hex)를 만듭니다. 원문 토큰은 DB에 남기지 않습니다. */
export function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
