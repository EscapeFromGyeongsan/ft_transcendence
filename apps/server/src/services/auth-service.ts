import type { Database, Executor } from "../db/client.ts";
import type { OAuth42Config } from "../core/oauth-42.ts";
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
  // 42 Intra OAuth app. Without it the OAuth endpoints answer 503.
  oauth42?: OAuth42Config;
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

/**
 * PostgreSQL UNIQUE 위반(23505)이면 위반한 제약 이름을 돌려줍니다.
 *
 * @returns 제약 이름. UNIQUE 위반이 아니면 `undefined`
 */
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

/** 필요한 설정(DB·JWT·2FA 키·OAuth 앱)이 없어 기능을 쓸 수 없을 때 던집니다. 라우트에서 503으로 바뀝니다. */
export class ServiceUnavailableError extends Error {}

const CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;

/**
 * 가입·로그인·토큰 갱신·로그아웃과 access token 인증을 맡는 서비스를 만듭니다.
 *
 * @param twoFactor - 없으면 2FA 로그인 두 번째 단계가 {@link ServiceUnavailableError}를 던집니다.
 * @param onSessionRevoked - refresh token 재사용으로 세션이 폐기되면 commit 후에 호출됩니다. 실시간 계층이 그 세션의 연결을 닫는 데 씁니다(IF-03).
 *   로그아웃은 호출자가 이미 세션 종료를 알므로 여기로 알리지 않습니다.
 */
export function createAuthService(
  db: Database,
  config: AuthConfig,
  twoFactor?: TwoFactorService,
  onSessionRevoked?: (sessionId: string) => void,
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

  /**
   * 인증을 마친 사용자의 로그인을 완료합니다.
   *
   * @returns 2FA 계정이면 세션 대신 5분짜리 challenge token, 아니면 새 세션의 토큰 쌍
   *
   * @remarks 비밀번호 로그인과 OAuth 로그인이 함께 써서 두 경로에 같은 2FA 정책이 적용됩니다.
   */
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
    /**
     * 계정을 만듭니다. 이메일은 소문자로 저장하고 비밀번호는 Argon2id 해시만 저장합니다.
     *
     * @returns 이메일·닉네임이 이미 있으면 `EMAIL_TAKEN`·`NICKNAME_TAKEN`
     */
    async register(input: {
      email: string;
      password: string;
      nickname: string;
    }): Promise<RegisterResult> {
      const passwordHash = await hashPassword(input.password);
      try {
        const user = await repo.insertUser(db, {
          email: input.email.toLowerCase(),
          nickname: input.nickname.normalize("NFC"),
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

    /**
     * 이메일·비밀번호를 확인하고 로그인을 완료합니다.
     *
     * @returns 실패하면 `null`. 없는 계정·OAuth 전용 계정·틀린 비밀번호를 구분하지 않습니다.
     *
     * @remarks 없는 계정에도 같은 비용의 해시 비교를 해서 응답 시간으로 가입 여부를 알 수 없게 합니다.
     */
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

    /**
     * 2FA 계정의 로그인 두 번째 단계로, challenge와 TOTP·복구 코드를 확인하고 세션을 시작합니다.
     *
     * @returns challenge가 없음·만료·사용됨이면 `UNAUTHENTICATED`, 코드가 틀리면 `INVALID_TWO_FACTOR_CODE`
     * @throws ServiceUnavailableError 2FA 서비스가 설정되지 않은 경우
     *
     * @remarks
     * challenge 행을 잠그고 한 트랜잭션에서 처리합니다. challenge는 한 번만 쓸 수 있고, 틀린 코드가 5번이면 폐기됩니다.
     */
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

    /**
     * refresh token을 회전하고 새 토큰 쌍을 발급합니다.
     *
     * @returns 토큰이 없음·만료·세션 폐기·세션 만료·재사용이면 `null`
     *
     * @remarks
     * 토큰 행을 잠가 같은 토큰의 동시 갱신 중 하나만 성공합니다. 새 토큰의 만료는 세션 만료를 넘지 않습니다.
     * 이미 회전된 토큰이 다시 오면 탈취로 보고 세션 전체를 폐기한 뒤, commit 후 `onSessionRevoked`를 한 번 호출합니다.
     */
    async refresh(refreshToken: string): Promise<TokenPair | null> {
      const now = new Date();
      let revokedSessionId: string | undefined;
      const tokens = await db.transaction(async (tx) => {
        const row = await repo.findRefreshTokenForUpdate(
          tx,
          hashRefreshToken(refreshToken),
        );
        if (!row) return null;
        if (row.usedAt) {
          // Report only the first revocation; a repeated reuse changes nothing.
          if (!row.sessionRevokedAt) revokedSessionId = row.sessionId;
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
      if (revokedSessionId) onSessionRevoked?.(revokedSessionId);
      return tokens;
    },

    /** 세션을 폐기합니다. 그 세션의 access token과 refresh token은 만료 전이어도 이후 거절됩니다. */
    logout(sessionId: string) {
      return repo.revokeSession(db, sessionId, new Date());
    },

    /**
     * access token을 검증하고 서버 세션이 아직 유효한지 확인합니다.
     *
     * @returns 유효하면 claims, 아니면 `null`
     *
     * @remarks JWT 서명·만료만으로는 부족해서 세션도 확인합니다. 그래서 로그아웃은 access token 만료 전에 바로 적용됩니다.
     */
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
