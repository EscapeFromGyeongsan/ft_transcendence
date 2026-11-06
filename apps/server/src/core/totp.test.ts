import { expect, test } from "vitest";
import { createSecretBox } from "./secret-box.ts";
import {
  base32Decode,
  base32Encode,
  currentStep,
  totpCode,
  verifyTotp,
} from "./totp.ts";

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890".
const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

test("base32 round-trips and matches the RFC seed encoding", () => {
  expect(rfcSecret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  expect(base32Decode(rfcSecret).toString()).toBe("12345678901234567890");
});

test("TOTP codes match RFC 6238 test vectors (last 6 digits)", () => {
  expect(totpCode(rfcSecret, currentStep(59_000))).toBe("287082");
  expect(totpCode(rfcSecret, currentStep(1_111_111_109_000))).toBe("081804");
  expect(totpCode(rfcSecret, currentStep(2_000_000_000_000))).toBe("279037");
});

test("verify allows one step of drift and refuses replays", () => {
  const now = 1_111_111_109_000;
  const step = currentStep(now);
  const code = totpCode(rfcSecret, step);
  expect(verifyTotp(rfcSecret, code, null, now)).toBe(step);
  expect(verifyTotp(rfcSecret, code, null, now + 30_000)).toBe(step);
  expect(verifyTotp(rfcSecret, code, null, now + 90_000)).toBeNull();
  expect(verifyTotp(rfcSecret, code, step, now)).toBeNull();
  expect(verifyTotp(rfcSecret, "12345", null, now)).toBeNull();
});

test("secret box decrypts only with the same key and detects tampering", () => {
  const box = createSecretBox("key-material-key-material-key-material");
  const sealed = box.seal("JBSWY3DPEHPK3PXP");
  expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
  expect(box.open(sealed)).toBe("JBSWY3DPEHPK3PXP");
  const other = createSecretBox("another-key-another-key-another-key-xx");
  expect(() => other.open(sealed)).toThrow();
  const [iv, tag, data] = sealed.split(".");
  const flipped = data[0] === "A" ? `B${data.slice(1)}` : `A${data.slice(1)}`;
  expect(() => box.open([iv, tag, flipped].join("."))).toThrow();
});
