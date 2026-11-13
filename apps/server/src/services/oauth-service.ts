import { randomBytes } from "node:crypto";
import type { Database } from "../db/client.ts";
import type { OAuth42Client } from "../core/oauth-42.ts";
import { createRefreshToken, hashRefreshToken } from "../core/tokens.ts";
import {
  findActiveSession,
  insertUser,
} from "../repositories/auth-repository.ts";
import * as repo from "../repositories/oauth-repository.ts";
import {
  uniqueViolation,
  type AuthService,
  type LoginResult,
} from "./auth-service.ts";

const PROVIDER = "42";
const STATE_TTL_SECONDS = 10 * 60;
const NICKNAME_PATTERN = /^[\p{L}\p{N}_-]{2,32}$/u;

export type CallbackResult =
  | { ok: true; mode: "login"; login: LoginResult }
  | { ok: true; mode: "link" }
  | {
      ok: false;
      code:
        | "OAUTH_STATE_INVALID"
        | "OAUTH_FAILED"
        | "UNAUTHENTICATED"
        | "EMAIL_TAKEN"
        | "OAUTH_EMAIL_MISSING"
        | "OAUTH_ACCOUNT_LINKED"
        | "OAUTH_ALREADY_LINKED";
    };

// 42 login as nickname when free and valid, otherwise with a random suffix.
function nicknameCandidates(login: string) {
  const base =
    login
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}_-]/gu, "")
      .slice(0, 27) || "user";
  const suffixed = () => `${base}-${randomBytes(2).toString("hex")}`;
  // Enough suffixed tries that all of them being taken is not realistic.
  return [
    NICKNAME_PATTERN.test(base) ? base : suffixed(),
    ...Array.from({ length: 9 }, suffixed),
  ];
}

/**
 * 42 OAuth 로그인·계정 연결 흐름을 맡는 서비스를 만듭니다.
 *
 * @param auth - 로그인 완료(2FA 정책 포함)를 비밀번호 로그인과 같은 경로로 처리하기 위한 {@link AuthService}
 */
export function createOAuthService(
  db: Database,
  client: OAuth42Client,
  auth: AuthService,
) {
  // flowToken stays in the starting browser (the web keeps it in
  // sessionStorage) and must come back with the callback. A callback replayed
  // in another browser lacks it, which blocks login CSRF (RFC 9700 4.7.1).
  async function createAuthorizeUrl(
    mode: "login" | "link",
    owner: { userId: number; sessionId: string } | null,
  ) {
    const state = createRefreshToken();
    const flowToken = createRefreshToken();
    await repo.insertState(db, {
      stateHash: hashRefreshToken(state),
      provider: PROVIDER,
      mode,
      userId: owner?.userId ?? null,
      sessionId: owner?.sessionId ?? null,
      browserHash: hashRefreshToken(flowToken),
      expiresAt: new Date(Date.now() + STATE_TTL_SECONDS * 1000),
    });
    return { authorizeUrl: client.authorizeUrl(state), flowToken };
  }

  // First OAuth login creates a new account. An existing account with the same
  // email is NOT taken over (FR-AUTH-05); the user must log in and link.
  async function createAccount(profile: {
    providerUserId: string;
    email: string;
    login: string;
  }) {
    for (const nickname of nicknameCandidates(profile.login)) {
      try {
        return await db.transaction(async (tx) => {
          const user = await insertUser(tx, {
            email: profile.email.toLowerCase(),
            nickname,
            passwordHash: null,
          });
          await repo.insertAccount(tx, {
            userId: user.id,
            provider: PROVIDER,
            providerUserId: profile.providerUserId,
          });
          return { ok: true as const, userId: user.id };
        });
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (
          constraint === "users_email_unique" ||
          constraint === "oauth_accounts_provider_user_unique"
        ) {
          // A parallel first login for the same 42 user may have created the
          // account (it then owns this email too); use it. Otherwise the email
          // belongs to someone else.
          const winner = await repo.findAccount(
            db,
            PROVIDER,
            profile.providerUserId,
          );
          if (winner) return { ok: true as const, userId: winner.userId };
          if (constraint === "users_email_unique") {
            return { ok: false as const, code: "EMAIL_TAKEN" as const };
          }
        }
        if (constraint !== "users_nickname_unique") throw error;
      }
    }
    throw new Error("Could not find a free nickname.");
  }

  return {
    /**
     * 42 로그인 흐름을 시작합니다.
     *
     * @returns 42 인가 URL과 `flowToken`. `flowToken`은 시작한 브라우저가 보관했다가 callback에 함께 보내야 합니다.
     *
     * @remarks state는 10분 동안 한 번만 쓸 수 있고 DB에는 해시만 남습니다.
     */
    startLogin: () => createAuthorizeUrl("login", null),
    /**
     * 로그인한 계정에 42 계정을 연결하는 흐름을 시작합니다.
     *
     * @remarks 시작한 사용자와 세션을 state에 기록하고, callback에서 그 세션이 아직 유효한지 다시 확인합니다.
     */
    startLink: (userId: number, sessionId: string) =>
      createAuthorizeUrl("link", { userId, sessionId }),

    /**
     * 42 callback을 처리합니다. state를 소비한 뒤 code를 교환하고, mode에 따라 로그인 또는 계정 연결을 끝냅니다.
     *
     * @param flowToken - 흐름을 시작한 브라우저가 보관한 값. 다르면 `OAUTH_STATE_INVALID`
     * @throws OAuthProviderError 42에 연결할 수 없거나 응답이 예상과 다른 경우
     *
     * @remarks
     * state는 code 교환 전에 소비하므로 같은 callback은 한 번만 처리됩니다.
     * 처음 보는 42 사용자는 새 계정을 만듭니다. 같은 이메일의 기존 계정은 가져오지 않고 `EMAIL_TAKEN`으로 거절합니다(FR-AUTH-05).
     * 같은 42 사용자의 첫 로그인이 동시에 들어오면 먼저 만든 계정을 씁니다.
     * 로그인 결과는 비밀번호 로그인과 같은 2FA 정책을 따릅니다.
     */
    async callback(
      code: string,
      state: string,
      flowToken: string,
    ): Promise<CallbackResult> {
      const saved = await repo.consumeState(
        db,
        hashRefreshToken(state),
        hashRefreshToken(flowToken),
        PROVIDER,
      );
      if (!saved) return { ok: false, code: "OAUTH_STATE_INVALID" };
      const profile = await client.exchange(code);
      if (!profile) return { ok: false, code: "OAUTH_FAILED" };
      const existing = await repo.findAccount(
        db,
        PROVIDER,
        profile.providerUserId,
      );

      if (saved.mode === "link") {
        const userId = saved.userId!;
        // The session that started linking must still be signed in.
        const session = await findActiveSession(
          db,
          saved.sessionId!,
          userId,
          new Date(),
        );
        if (!session) return { ok: false, code: "UNAUTHENTICATED" };
        if (existing) {
          return existing.userId === userId
            ? { ok: true, mode: "link" }
            : { ok: false, code: "OAUTH_ACCOUNT_LINKED" };
        }
        try {
          await repo.insertAccount(db, {
            userId,
            provider: PROVIDER,
            providerUserId: profile.providerUserId,
          });
        } catch (error) {
          const constraint = uniqueViolation(error);
          if (constraint === "oauth_accounts_user_provider_unique") {
            return { ok: false, code: "OAUTH_ALREADY_LINKED" };
          }
          // Another user linked this 42 account at the same moment.
          if (constraint === "oauth_accounts_provider_user_unique") {
            const owner = await repo.findAccount(
              db,
              PROVIDER,
              profile.providerUserId,
            );
            return owner?.userId === userId
              ? { ok: true, mode: "link" }
              : { ok: false, code: "OAUTH_ACCOUNT_LINKED" };
          }
          throw error;
        }
        return { ok: true, mode: "link" };
      }

      let userId = existing?.userId;
      if (userId === undefined) {
        // An email longer than users.email allows cannot be stored either.
        if (!profile.email || profile.email.length > 254) {
          return { ok: false, code: "OAUTH_EMAIL_MISSING" };
        }
        const created = await createAccount({
          ...profile,
          email: profile.email,
        });
        if (!created.ok) return created;
        userId = created.userId;
      }
      // Same 2FA policy as password login.
      const login = await auth.completeLogin(userId);
      // The account was deleted while this callback ran; the state is already used.
      if (!login) return { ok: false, code: "OAUTH_STATE_INVALID" };
      return { ok: true, mode: "login", login };
    },
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
