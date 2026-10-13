import { createHash, randomBytes } from "node:crypto";
import type { Database, Executor } from "../db/client.ts";
import type { SecretBox } from "../core/secret-box.ts";
import {
  base32Encode,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from "../core/totp.ts";
import * as repo from "../repositories/two-factor-repository.ts";

const ISSUER = "Cyber Board Cafe";
const RECOVERY_CODE_COUNT = 10;

// Recovery code shown to the user as "ABCD-EFGH"; stored as a SHA-256 hash of
// the normalized value (40 random bits each, single use).
function normalizeRecoveryCode(code: string) {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function hashRecoveryCode(code: string) {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(5));
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}

export type EnableResult =
  | { ok: true; recoveryCodes: string[] }
  | {
      ok: false;
      code:
        | "TWO_FACTOR_NOT_SET_UP"
        | "TWO_FACTOR_ALREADY_ENABLED"
        | "INVALID_TWO_FACTOR_CODE";
    };

export function createTwoFactorService(db: Database, box: SecretBox) {
  // Checks a TOTP code or consumes a recovery code. The secret row is locked
  // so two requests cannot both accept the same code.
  async function verifyCode(tx: Executor, userId: number, code: string) {
    const secret = await repo.findSecret(tx, userId, true);
    if (!secret?.enabledAt) return false;
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(
        box.open(secret.secretEncrypted),
        code,
        secret.lastUsedStep,
      );
      if (step === null) return false;
      await repo.setLastUsedStep(tx, userId, step);
      return true;
    }
    return repo.consumeRecoveryCode(tx, userId, hashRecoveryCode(code));
  }

  return {
    verifyCode,

    isEnabled(userId: number) {
      return repo.isEnabled(db, userId);
    },

    async setup(userId: number, accountName: string) {
      return db.transaction(async (tx) => {
        const current = await repo.findSecret(tx, userId, true);
        if (current?.enabledAt) {
          return {
            ok: false as const,
            code: "TWO_FACTOR_ALREADY_ENABLED" as const,
          };
        }
        const secret = generateTotpSecret();
        await repo.savePendingSecret(tx, userId, box.seal(secret));
        return {
          ok: true as const,
          secret,
          otpauthUrl: otpauthUrl(secret, accountName, ISSUER),
        };
      });
    },

    // Activation requires a valid code from the new secret, so a wrong scan
    // never locks the user out.
    async enable(userId: number, code: string): Promise<EnableResult> {
      return db.transaction(async (tx) => {
        const current = await repo.findSecret(tx, userId, true);
        if (!current) return { ok: false, code: "TWO_FACTOR_NOT_SET_UP" };
        if (current.enabledAt) {
          return { ok: false, code: "TWO_FACTOR_ALREADY_ENABLED" };
        }
        const step = verifyTotp(box.open(current.secretEncrypted), code, null);
        if (step === null)
          return { ok: false, code: "INVALID_TWO_FACTOR_CODE" };
        await repo.enableSecret(tx, userId, step);
        const recoveryCodes = newRecoveryCodes();
        await repo.replaceRecoveryCodes(
          tx,
          userId,
          recoveryCodes.map(hashRecoveryCode),
        );
        return { ok: true, recoveryCodes };
      });
    },

    async disable(userId: number, code: string) {
      return db.transaction(async (tx) => {
        if (!(await repo.isEnabled(tx, userId))) {
          return {
            ok: false as const,
            code: "TWO_FACTOR_NOT_ENABLED" as const,
          };
        }
        if (!(await verifyCode(tx, userId, code))) {
          return {
            ok: false as const,
            code: "INVALID_TWO_FACTOR_CODE" as const,
          };
        }
        await repo.deleteTwoFactor(tx, userId);
        return { ok: true as const };
      });
    },
  };
}

export type TwoFactorService = ReturnType<typeof createTwoFactorService>;
