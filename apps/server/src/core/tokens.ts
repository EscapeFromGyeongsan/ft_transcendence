import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type AccessTokenClaims = { userId: number; sessionId: string };

// Only this exact header is accepted, so "alg": "none" or algorithm swaps fail.
const HEADER = Buffer.from(
  JSON.stringify({ alg: "HS256", typ: "JWT" }),
).toString("base64url");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

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

// Opaque refresh token. The client keeps the raw value; the DB keeps the hash.
export function createRefreshToken() {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
