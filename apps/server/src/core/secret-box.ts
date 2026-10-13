import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// AES-256-GCM for secrets the server must read back (TOTP seeds). The key is
// derived from TWO_FACTOR_KEY so the raw env value is never used directly.
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
