import { randomBytes } from "node:crypto";
import type { Database } from "../db/client.ts";
import type { OAuth42Client } from "../core/oauth-42.ts";
import { createRefreshToken, hashRefreshToken } from "../core/tokens.ts";
import { insertUser } from "../repositories/auth-repository.ts";
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
        | "EMAIL_TAKEN"
        | "OAUTH_EMAIL_MISSING"
        | "OAUTH_ACCOUNT_LINKED"
        | "OAUTH_ALREADY_LINKED";
    };

// 42 login as nickname when free and valid, otherwise with a random suffix.
function nicknameCandidates(login: string) {
  const base = login.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 27) || "user";
  const suffixed = () => `${base}-${randomBytes(2).toString("hex")}`;
  return [
    NICKNAME_PATTERN.test(base) ? base : suffixed(),
    suffixed(),
    suffixed(),
  ];
}

export function createOAuthService(
  db: Database,
  client: OAuth42Client,
  auth: AuthService,
) {
  async function createAuthorizeUrl(
    mode: "login" | "link",
    userId: number | null,
  ) {
    const state = createRefreshToken();
    await repo.insertState(db, {
      stateHash: hashRefreshToken(state),
      provider: PROVIDER,
      mode,
      userId,
      expiresAt: new Date(Date.now() + STATE_TTL_SECONDS * 1000),
    });
    return client.authorizeUrl(state);
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
        if (constraint === "users_email_unique") {
          return { ok: false as const, code: "EMAIL_TAKEN" as const };
        }
        // A parallel first login for the same 42 user won the race; use it.
        if (constraint === "oauth_accounts_provider_user_unique") {
          const winner = await repo.findAccount(
            db,
            PROVIDER,
            profile.providerUserId,
          );
          if (winner) return { ok: true as const, userId: winner.userId };
        }
        if (constraint !== "users_nickname_unique") throw error;
      }
    }
    throw new Error("Could not find a free nickname.");
  }

  return {
    startLogin: () => createAuthorizeUrl("login", null),
    startLink: (userId: number) => createAuthorizeUrl("link", userId),

    async callback(code: string, state: string): Promise<CallbackResult> {
      const saved = await repo.consumeState(
        db,
        hashRefreshToken(state),
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
          if (
            uniqueViolation(error) === "oauth_accounts_user_provider_unique"
          ) {
            return { ok: false, code: "OAUTH_ALREADY_LINKED" };
          }
          throw error;
        }
        return { ok: true, mode: "link" };
      }

      let userId = existing?.userId;
      if (userId === undefined) {
        if (!profile.email) return { ok: false, code: "OAUTH_EMAIL_MISSING" };
        const created = await createAccount({
          ...profile,
          email: profile.email,
        });
        if (!created.ok) return created;
        userId = created.userId;
      }
      // Same 2FA policy as password login.
      return {
        ok: true,
        mode: "login",
        login: await auth.completeLogin(userId),
      };
    },
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
