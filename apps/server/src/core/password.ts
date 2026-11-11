import argon2 from "argon2";

// OWASP baseline for Argon2id (19 MiB, 2 iterations, 1 lane). Tune after
// measuring on the real runtime.
const options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** 비밀번호를 위 Argon2id 설정으로 해시합니다. 결과 문자열에 salt와 설정이 함께 들어갑니다. */
export function hashPassword(password: string) {
  return argon2.hash(password, options);
}

/**
 * 저장된 해시와 비밀번호를 비교합니다.
 *
 * @returns 일치하면 `true`. 해시 형식이 깨져 있어도 예외 없이 `false`
 */
export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * 없는 계정에도 실제 검증과 같은 비용의 비교를 한 번 수행하고 항상 `false`를 돌려줍니다.
 *
 * @remarks
 * 응답 시간으로 가입된 이메일을 알아낼 수 없게 하려는 용도입니다. 더미 해시는 첫 호출 때 한 번 만듭니다.
 */
export async function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
  return false;
}
