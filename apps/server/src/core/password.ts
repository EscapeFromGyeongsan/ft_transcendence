import argon2 from "argon2";

// OWASP baseline for Argon2id (19 MiB, 2 iterations, 1 lane). Tune after
// measuring on the real runtime.
const options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string) {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

// Run a full verify even when the email is unknown so response time does not
// reveal which emails are registered.
export async function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
  return false;
}
