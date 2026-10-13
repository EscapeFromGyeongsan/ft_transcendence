import type { Database } from "../db/client.ts";
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

export type AuthConfig = {
  jwtSecret: string;
  // Defaults follow the design doc example values (access 30 min, refresh 7 days).
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
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

function uniqueViolation(error: unknown) {
  // Drizzle wraps driver errors; the pg error is on `cause`.
  const pgError = (error as { cause?: unknown }).cause ?? error;
  const { code, constraint } = pgError as {
    code?: string;
    constraint?: string;
  };
  return code === "23505" ? constraint : undefined;
}

export function createAuthService(db: Database, config: AuthConfig) {
  const accessTtl = config.accessTtlSeconds ?? 30 * 60;
  const refreshTtl = config.refreshTtlSeconds ?? 7 * 24 * 60 * 60;

  async function issueTokens(
    executor: Parameters<typeof repo.insertRefreshToken>[0],
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
    }): Promise<TokenPair | null> {
      const user = await repo.findUserCredentialsByEmail(
        db,
        input.email.toLowerCase(),
      );
      const valid = user
        ? await verifyPassword(user.passwordHash, input.password)
        : await verifyAgainstDummy(input.password);
      if (!user || !valid) return null;
      const expiresAt = new Date(Date.now() + refreshTtl * 1000);
      return db.transaction(async (tx) => {
        const session = await repo.insertSession(tx, {
          userId: user.id,
          expiresAt,
        });
        return issueTokens(
          tx,
          { userId: user.id, sessionId: session.id },
          session.expiresAt,
        );
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
