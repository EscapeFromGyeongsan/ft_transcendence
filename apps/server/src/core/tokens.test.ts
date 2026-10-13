import { expect, test } from "vitest";
import { signAccessToken, verifyAccessToken } from "./tokens.ts";

const secret = "test-secret-test-secret-test-secret";
const claims = { userId: 7, sessionId: "0b6f6e9e-5d43-4c7a-9a59-3c1f4f6c2a11" };

test("valid access token round-trips its claims", () => {
  const token = signAccessToken(claims, secret, 60);
  expect(verifyAccessToken(token, secret)).toEqual(claims);
});

test("expired, tampered or foreign-signed tokens are rejected", () => {
  const now = Date.now();
  const token = signAccessToken(claims, secret, 60, now);
  expect(verifyAccessToken(token, secret, now + 61_000)).toBeNull();
  expect(
    verifyAccessToken(token, "another-secret-another-secret-xx"),
  ).toBeNull();
  const [header, , signature] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ sub: "1", sid: claims.sessionId, iat: 0, exp: 9e9 }),
  ).toString("base64url");
  expect(
    verifyAccessToken(`${header}.${forged}.${signature}`, secret),
  ).toBeNull();
});

test('"alg": "none" tokens are rejected', () => {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "7", sid: claims.sessionId, iat: 0, exp: 9e9 }),
  ).toString("base64url");
  expect(verifyAccessToken(`${header}.${payload}.`, secret)).toBeNull();
});
