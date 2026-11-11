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

/**
 * TOTP 2FA 설정·활성화·해제와 코드 검증 서비스를 만듭니다.
 *
 * @param box - TOTP secret 암호화에 쓰는 {@link SecretBox}
 */
export function createTwoFactorService(db: Database, box: SecretBox) {
  /**
   * 6자리 TOTP 코드를 확인하거나, 그 밖의 입력은 복구 코드로 보고 사용 처리합니다.
   *
   * @param tx - 호출자의 트랜잭션. secret 행 잠금과 사용 기록이 그 트랜잭션에 묶입니다.
   * @returns 통과하면 `true`. 2FA가 켜져 있지 않으면 `false`
   *
   * @remarks
   * secret 행을 잠그므로 두 요청이 같은 코드를 둘 다 통과시키지 못합니다. 통과한 TOTP step은 저장되어 다시 쓸 수 없습니다.
   */
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

    /**
     * 확인 전의 새 TOTP secret을 만들고 인증 앱 등록 정보를 돌려줍니다.
     *
     * @param accountName - 인증 앱에 표시할 계정 이름
     * @returns 이미 켜져 있으면 `TWO_FACTOR_ALREADY_ENABLED`
     *
     * @remarks 다시 호출하면 확인 전 secret을 새 값으로 바꿉니다. 켜진 secret은 바꾸지 않습니다.
     */
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
        if (!(await repo.savePendingSecret(tx, userId, box.seal(secret)))) {
          return {
            ok: false as const,
            code: "TWO_FACTOR_ALREADY_ENABLED" as const,
          };
        }
        return {
          ok: true as const,
          secret,
          otpauthUrl: otpauthUrl(secret, accountName, ISSUER),
        };
      });
    },

    /**
     * 새 secret의 코드로 확인한 뒤 2FA를 켜고 복구 코드 10개를 발급합니다.
     *
     * @returns 성공하면 복구 코드 원문. 원문은 이때만 돌려주고 DB에는 해시만 남습니다.
     *
     * @remarks 유효한 코드가 있어야 켜지므로 잘못 스캔해도 계정이 잠기지 않습니다.
     */
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

    /**
     * TOTP 코드 또는 복구 코드를 확인한 뒤 2FA를 끄고 secret·복구 코드를 지웁니다.
     *
     * @remarks 기존 세션은 그대로 유지합니다.
     */
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
