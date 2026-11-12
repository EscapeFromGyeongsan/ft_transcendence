import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * 서버가 다시 읽어야 하는 비밀값(TOTP seed)을 AES-256-GCM으로 암호화·복호화합니다.
 *
 * @param keyMaterial - `TWO_FACTOR_KEY` 값. HKDF로 키를 유도하므로 원문을 키로 직접 쓰지 않습니다.
 *
 * @remarks
 * `seal()`은 호출마다 새 12바이트 IV를 쓰고 `iv.tag.data`(base64url) 형식을 돌려줍니다.
 * `open()`은 키가 다르거나 내용이 변조되면 예외를 던집니다.
 */
export function createSecretBox(keyMaterial: string) {
  const key = Buffer.from(
    hkdfSync("sha256", keyMaterial, "", "cafe-two-factor-secret", 32),
  );
  return {
    seal(plain: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), data]
        .map((part) => part.toString("base64url"))
        .join(".");
    },
    open(sealed: string) {
      const [iv, tag, data] = sealed
        .split(".")
        .map((part) => Buffer.from(part, "base64url"));
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}

export type SecretBox = ReturnType<typeof createSecretBox>;
