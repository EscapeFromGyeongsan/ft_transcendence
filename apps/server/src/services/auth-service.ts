import type { Database, Executor } from "../db/client.ts";
import {
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "../core/password.ts";
import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type AccessTokenClaims,
} from "../core/tokens.ts";
import * as repo from "../repositories/auth-repository.ts";
import * as twoFactorRepo from "../repositories/two-factor-repository.ts";
import type { TwoFactorService } from "./two-factor-service.ts";

export type AuthConfig = {
  jwtSecret: string;
  // Defaults follow the design doc example values (access 30 min, refresh 7 days).
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  // Encrypts TOTP secrets. Without it the 2FA endpoints answer 503.
  twoFactorKey?: string;
};

export type TokenPair = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
};

export type RegisterResult =
  | { ok: true; user: repo.PublicUser }
  | { ok: false; code: "EMAIL_TAKEN" | "NICKNAME_TAKEN" };

export function uniqueViolation(error: unknown) {
  // Drizzle wraps driver errors; the pg error is on `cause`.
  const pgError = (error as { cause?: unknown }).cause ?? error;
  const { code, constraint } = pgError as {
    code?: string;
    constraint?: string;
  };
  return code === "23505" ? constraint : undefined;
}

export type LoginResult =
  | TokenPair
  | { twoFactorRequired: true; challengeToken: string; expiresIn: number };

export type TwoFactorLoginResult =
  | { ok: true; tokens: TokenPair }
  | { ok: false; code: "UNAUTHENTICATED" | "INVALID_TWO_FACTOR_CODE" };

export class ServiceUnavailableError extends Error {}

const CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;

export function createAuthService(
  db: Database,
  config: AuthConfig,
  twoFactor?: TwoFactorService,
) {
  const accessTtl = config.accessTtlSeconds ?? 30 * 60;
  const refreshTtl = config.refreshTtlSeconds ?? 7 * 24 * 60 * 60;

  async function issueTokens(
    executor: Executor,
    claims: AccessTokenClaims,
    expiresAt: Date,
  ): Promise<TokenPair> {
    const refreshToken = createRefreshToken();
    await repo.insertRefreshToken(executor, {
      sessionId: claims.sessionId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
    });
    return {
      accessToken: signAccessToken(claims, config.jwtSecret, accessTtl),
      tokenType: "Bearer",
      expiresIn: accessTtl,
      refreshToken,
    };
  }

  async function startSession(executor: Executor, userId: number) {
    const session = await repo.insertSession(executor, {
      userId,
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });
    return issueTokens(
      executor,
      { userId, sessionId: session.id },
      session.expiresAt,
    );
  }

  // Shared by password and OAuth login: 2FA accounts get a challenge instead
  // of a session, so both paths apply the same 2FA policy.
  async function completeLogin(userId: number): Promise<LoginResult> {
    if (await twoFactorRepo.isEnabled(db, userId)) {
      const challengeToken = createRefreshToken();
      await twoFactorRepo.insertChallenge(db, {
        userId,
        tokenHash: hashRefreshToken(challengeToken),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
      });
      return {
        twoFactorRequired: true,
        challengeToken,
        expiresIn: CHALLENGE_TTL_SECONDS,
      };
    }
    return db.transaction((tx) => startSession(tx, userId));
  }

  return {
    async register(input: {
      email: string;
      password: string;
      nickname: string;
    }): Promise<RegisterResult> {
      const passwordHash = await hashPassword(input.password);
      try {
        const user = await repo.insertUser(db, {
          email: input.email.toLowerCase(),
          nickname: input.nickname,
          passwordHash,
        });
        return { ok: true, user };
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (constraint === "users_email_unique") {
          return { ok: false, code: "EMAIL_TAKEN" };
        }
        if (constraint === "users_nickname_unique") {
          return { ok: false, code: "NICKNAME_TAKEN" };
        }
        throw error;
      }
    },

    async login(input: {
      email: string;
      password: string;
    }): Promise<LoginResult | null> {
      const user = await repo.findUserCredentialsByEmail(
        db,
        input.email.toLowerCase(),
      );
      // OAuth-only accounts have no password and cannot log in this way.
      const valid = user?.passwordHash
        ? await verifyPassword(user.passwordHash, input.password)
        : await verifyAgainstDummy(input.password);
      if (!user || !valid) return null;
      return completeLogin(user.id);
    },

    completeLogin,

    // Second login step for 2FA accounts. A challenge is single use and is
    // discarded after too many wrong codes.
    async verifyTwoFactorLogin(
      challengeToken: string,
      code: string,
    ): Promise<TwoFactorLoginResult> {
      if (!twoFactor) throw new ServiceUnavailableError();
      const now = new Date();
      return db.transaction(async (tx) => {
        const challenge = await twoFactorRepo.findChallengeForUpdate(
          tx,
          hashRefreshToken(challengeToken),
        );
        if (!challenge || challenge.usedAt || challenge.expiresAt <= now) {
          return { ok: false, code: "UNAUTHENTICATED" };
        }
        if (!(await twoFactor.verifyCode(tx, challenge.userId, code))) {
          const failedAttempts = challenge.failedAttempts + 1;
          await twoFactorRepo.updateChallenge(tx, challenge.id, {
            failedAttempts,
            ...(failedAttempts >= MAX_CHALLENGE_ATTEMPTS
              ? { usedAt: now }
              : {}),
          });
          return { ok: false, code: "INVALID_TWO_FACTOR_CODE" };
        }
        await twoFactorRepo.updateChallenge(tx, challenge.id, { usedAt: now });
        return { ok: true, tokens: await startSession(tx, challenge.userId) };
      });
    },

    // Rotates the refresh token. Reusing an already rotated token is treated as
    // theft and revokes the whole session.
    async refresh(refreshToken: string): Promise<TokenPair | null> {
      const now = new Date();
      return db.transaction(async (tx) => {
        const row = await repo.findRefreshTokenForUpdate(
          tx,
          hashRefreshToken(refreshToken),
        );
        if (!row) return null;
        if (row.usedAt) {
          await repo.revokeSession(tx, row.sessionId, now);
          return null;
        }
        if (
          row.sessionRevokedAt ||
          row.expiresAt <= now ||
          row.sessionExpiresAt <= now
        ) {
          return null;
        }
        await repo.markRefreshTokenUsed(tx, row.id, now);
        return issueTokens(
          tx,
          { userId: row.userId, sessionId: row.sessionId },
          row.sessionExpiresAt,
        );
      });
    },

    logout(sessionId: string) {
      return repo.revokeSession(db, sessionId, new Date());
    },

    // JWT signature/expiry alone is not enough: the server session must still
    // be active, so logout takes effect before the access token expires.
    async authenticate(accessToken: string): Promise<AccessTokenClaims | null> {
      const claims = verifyAccessToken(accessToken, config.jwtSecret);
      if (!claims) return null;
      const session = await repo.findActiveSession(
        db,
        claims.sessionId,
        claims.userId,
        new Date(),
      );
      return session ? claims : null;
    },

    getUser(userId: number) {
      return repo.findUserById(db, userId);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
